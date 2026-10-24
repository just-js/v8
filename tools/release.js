#!/usr/bin/env node
// Tag a commit as a V8 version, push the tag, and optionally publish the
// GitHub release that starts the release build (main.yml). Node 20+, no
// dependencies.
//
// usage: node tools/release.js [--release] [--dry-run] <version> [commit]
//   e.g. node tools/release.js --release 15.6
//
//   commit     default: the HEAD of local main, which must equal origin/main
//   --release  also publish the release (needs $GH_TOKEN or $GITHUB_TOKEN with
//              Contents: Read and write). Re-running with --release when the
//              tag is already on origin at the same commit only publishes.
//   --dry-run  do every check, print what would happen, change nothing
//
// Refuses unless the commit's build.yml builds V8_VERSION <version>, since
// the release build uses whatever the tagged commit says.

import { execFileSync } from 'node:child_process'

const YML = '.github/workflows/build.yml'

function fail (msg) {
  console.error(msg)
  process.exit(1)
}

function git (...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function gitOk (...args) {
  try {
    execFileSync('git', args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function originRepo () {
  const url = git('remote', 'get-url', 'origin')
  const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/)
  if (!m) fail(`can't get owner/repo from origin remote ${url}`)
  return m[1]
}

function builtVersion (rev) {
  const m = git('show', `${rev}:${YML}`).match(/^ *V8_VERSION: *"([^"]*)"/m)
  return m ? m[1] : null
}

function isVersion (v) {
  return /^\d+\.\d+$/.test(v)
}

function compareVersions (a, b) {
  const [a1, a2] = a.split('.').map(Number)
  const [b1, b2] = b.split('.').map(Number)
  return a1 - b1 || a2 - b2
}

const args = process.argv.slice(2)
const release = args.includes('--release')
const dryRun = args.includes('--dry-run')
const [version, commit = 'main'] = args.filter(a => !a.startsWith('--'))
if (!version || !isVersion(version) || args.some(a => a.startsWith('--') && a !== '--release' && a !== '--dry-run')) {
  fail('usage: node tools/release.js [--release] [--dry-run] <version> [commit]   (version like 15.6)')
}
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
if (release && !token) fail('--release needs $GH_TOKEN or $GITHUB_TOKEN')

const repo = originRepo()
git('fetch', '-q', '--tags', 'origin')
if (!gitOk('rev-parse', '--verify', `${commit}^{commit}`)) fail(`no such commit: ${commit}`)
const sha = git('rev-parse', '--verify', `${commit}^{commit}`)
if (commit === 'main' && sha !== git('rev-parse', 'origin/main')) {
  fail('local main is not origin/main; pull or push first')
}

const built = builtVersion(sha)
if (built !== version) fail(`${sha} builds V8_VERSION "${built}", not "${version}"`)

const remote = git('ls-remote', '--tags', 'origin', `refs/tags/${version}`).split('\t')[0]
if (!remote) {
  if (gitOk('rev-parse', '-q', '--verify', `refs/tags/${version}`)) {
    fail(`tag ${version} exists locally but not on origin`)
  }
  if (dryRun) {
    console.log(`would tag ${sha} as ${version} and push the tag`)
  } else {
    git('tag', version, sha)
    git('push', '-q', 'origin', `refs/tags/${version}`)
    console.log(`tagged ${sha} as ${version} and pushed`)
  }
} else if (release && remote === sha) {
  console.log(`tag ${version} already on origin at ${sha}`)
} else {
  fail(`tag ${version} already exists on origin (${remote})`)
}

if (!release) process.exit(0)

const api = `https://api.github.com/repos/${repo}`
const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  Authorization: `Bearer ${token}`
}

const existing = await fetch(`${api}/releases/tags/${version}`, { headers })
if (existing.status !== 404) fail(`release ${version} already exists (HTTP ${existing.status})`)

// same body as the earlier releases: "- V8 Release X" + the changelog link.
// The previous version is the highest version tag below this one; in a dry
// run the new tag doesn't exist yet, which doesn't change that.
const prev = git('tag', '--list').split('\n')
  .filter(t => isVersion(t) && compareVersions(t, version) < 0)
  .sort(compareVersions)
  .pop()
let body = `- V8 Release ${version}`
// the exact V8 the release is built from: build.yml's V8_COMMIT and its comment
// ("15.6.75.19, Chrome 156.0.8078.47 Stable"), when the commit has one
const pin = git('show', `${sha}:${YML}`).match(/^ *V8_COMMIT: *"([0-9a-f]{40})"(?: *# *(.*))?$/m)
if (pin) body += `\n- V8 commit [${pin[1].slice(0, 12)}](https://github.com/v8/v8/commit/${pin[1]})${pin[2] ? ` (${pin[2].trim()})` : ''}`
if (prev) body += `\n\n**Full Changelog**: https://github.com/${repo}/compare/${prev}...${version}`
const payload = { tag_name: version, name: version, body, draft: false, prerelease: false }

if (dryRun) {
  console.log(`would publish release ${version} on ${repo}:`)
  console.log(JSON.stringify(payload, null, 2))
  process.exit(0)
}

const res = await fetch(`${api}/releases`, { method: 'POST', headers, body: JSON.stringify(payload) })
if (res.status !== 201) fail(`creating release ${version} failed (HTTP ${res.status}): ${await res.text()}`)
const created = await res.json()
console.log(`published release ${version}: ${created.html_url}`)
console.log(`release build: https://github.com/${repo}/actions/workflows/main.yml`)
