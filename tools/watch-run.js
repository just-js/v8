#!/usr/bin/env node
// Watch one GitHub Actions workflow run until it finishes, then print each
// job's result. Node 20+, no dependencies.
//
// usage: node tools/watch-run.js <run-id | run-url> [--interval <seconds>]
//          [--repo <owner/repo>] [--once] [--json]
//
//   --interval  seconds between checks while the run is going (default 600)
//   --repo      default: the run URL's repo, else the origin remote's
//   --once      check once and exit, even if the run hasn't finished
//   --json      print the final state as JSON instead of text
//
// Token: $GH_TOKEN or $GITHUB_TOKEN if set (public repos work without one,
// at GitHub's lower unauthenticated rate limit).
//
// Exit code: 0 = run finished with success, 1 = finished with any other
// conclusion, 3 = still running (--once), 2 = usage or repeated API errors.

import { execFileSync } from 'node:child_process'

const MAX_API_ERRORS = 5

function usage (msg) {
  if (msg) console.error(msg)
  console.error('usage: node tools/watch-run.js <run-id | run-url> [--interval <seconds>] [--repo <owner/repo>] [--once] [--json]')
  process.exit(2)
}

function originRepo () {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
  const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/)
  if (!m) usage(`can't get owner/repo from origin remote ${url}; pass --repo`)
  return m[1]
}

function parseArgs (argv) {
  const opts = { interval: 600, once: false, json: false, repo: null, runId: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--once') opts.once = true
    else if (a === '--json') opts.json = true
    else if (a === '--interval') opts.interval = Number(argv[++i])
    else if (a === '--repo') opts.repo = argv[++i]
    else if (a.startsWith('--')) usage(`unknown option ${a}`)
    else if (opts.runId) usage(`unexpected argument ${a}`)
    else {
      const m = a.match(/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/)
      if (m) {
        opts.repo = opts.repo || m[1]
        opts.runId = m[2]
      } else if (/^\d+$/.test(a)) {
        opts.runId = a
      } else {
        usage(`not a run id or run URL: ${a}`)
      }
    }
  }
  if (!opts.runId) usage()
  if (!(opts.interval >= 10)) usage('--interval must be at least 10 seconds')
  opts.repo = opts.repo || originRepo()
  return opts
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
if (token) headers.Authorization = `Bearer ${token}`

async function api (path) {
  const res = await fetch(`https://api.github.com${path}`, { headers })
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function jobs (repo, runId) {
  const all = []
  for (let page = 1; ; page++) {
    const r = await api(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`)
    all.push(...r.jobs)
    if (all.length >= r.total_count || r.jobs.length === 0) return all
  }
}

function minutes (from, to) {
  if (!from || !to) return null
  return Math.round((Date.parse(to) - Date.parse(from)) / 60000)
}

async function check (repo, runId) {
  const run = await api(`/repos/${repo}/actions/runs/${runId}`)
  const list = await jobs(repo, runId)
  return {
    run: {
      id: run.id,
      name: run.name,
      event: run.event,
      head_branch: run.head_branch,
      head_sha: run.head_sha,
      run_attempt: run.run_attempt,
      status: run.status,
      conclusion: run.conclusion,
      html_url: run.html_url
    },
    jobs: list.map(j => ({
      id: j.id,
      name: j.name,
      status: j.status,
      conclusion: j.conclusion,
      minutes: minutes(j.started_at, j.completed_at),
      failed_steps: (j.steps || []).filter(s => s.conclusion === 'failure').map(s => s.name),
      html_url: j.html_url
    }))
  }
}

function progress (state) {
  const counts = {}
  for (const j of state.jobs) {
    const k = j.status === 'completed' ? j.conclusion : j.status
    counts[k] = (counts[k] || 0) + 1
  }
  const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')
  return `${new Date().toISOString().slice(0, 19)}Z run ${state.run.id} ${state.run.status}: ${summary || 'no jobs yet'}`
}

function report (state) {
  const r = state.run
  const lines = [`run ${r.id} (${r.name}, ${r.event} ${r.head_branch} ${r.head_sha.slice(0, 7)}, attempt ${r.run_attempt}): ${r.status} ${r.conclusion || ''}`, r.html_url]
  for (const j of state.jobs) {
    const result = j.status === 'completed' ? j.conclusion : j.status
    const time = j.minutes === null ? '' : ` ${j.minutes}m`
    const failed = j.failed_steps.length ? `  failed: ${j.failed_steps.join(', ')}` : ''
    lines.push(`  ${result.padEnd(11)} ${j.name}${time}${failed}`)
  }
  return lines.join('\n')
}

const opts = parseArgs(process.argv.slice(2))
let errors = 0
while (true) {
  let state
  try {
    state = await check(opts.repo, opts.runId)
    errors = 0
  } catch (err) {
    if (++errors >= MAX_API_ERRORS || opts.once) {
      console.error(err.message)
      process.exit(2)
    }
    console.error(`${err.message} (retrying, ${errors}/${MAX_API_ERRORS})`)
  }
  if (state && (state.run.status === 'completed' || opts.once)) {
    console.log(opts.json ? JSON.stringify(state, null, 2) : report(state))
    if (state.run.status !== 'completed') process.exit(3)
    process.exit(state.run.conclusion === 'success' ? 0 : 1)
  }
  if (state && !opts.json) console.log(progress(state))
  await new Promise(resolve => setTimeout(resolve, opts.interval * 1000))
}
