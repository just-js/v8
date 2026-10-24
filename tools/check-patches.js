#!/usr/bin/env node
// Tier 1 pre-check (see PLAN.md task 56 in the outer sandbox repo, and
// patches/README.md): before bumping V8_VERSION and pushing, check that
// every patch in patches/*.patch still applies cleanly against the real
// branch-heads/<version> source - no full V8 clone, no compile, just the
// specific files each patch touches, fetched straight from the GitHub
// mirror. Mechanizes exactly the "git apply --check" step patches/README.md
// already tells you to do by hand before committing a new patch, run here
// automatically for every current patch against a version you're
// considering bumping to.
//
// A patch target under a directory that V8 pulls in through DEPS (e.g.
// build/, Chromium's chromium/src/build repo) isn't in the v8/v8 mirror:
// those are fetched from chromium.googlesource.com at the revision DEPS pins
// for that ref, which is what CI's gclient sync checks out.
//
// Usage: node tools/check-patches.js <v8-version>
//   e.g. node tools/check-patches.js 14.9

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PATCHES_DIR = join(REPO_ROOT, 'patches')
const RAW_BASE = 'https://raw.githubusercontent.com/v8/v8'

function usageAndExit () {
  console.error('usage: node tools/check-patches.js <v8-version-or-commit>')
  console.error('  e.g. node tools/check-patches.js 14.9')
  console.error('       node tools/check-patches.js 4a3f9c1e2b...  (a branch-heads/* commit sha)')
  process.exit(2)
}

const versionArg = process.argv[2]
if (!versionArg) usageAndExit()

// A bare version like "14.9" means branch-heads/14.9; a commit sha (7-40
// hex chars, which a version string never is) is used directly as the ref
// - raw.githubusercontent.com accepts any valid git ref in this position.
const ref = /^[0-9a-f]{7,40}$/i.test(versionArg) ? versionArg : `branch-heads/${versionArg}`
const label = ref

// A patch may touch more than one file - collect every "+++ b/<path>"
// target, same layout patches/README.md documents (-p1, a/ b/ prefixes).
function targetPathsFromPatch (text) {
  const paths = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\+\+\+ b\/(.+)$/)
    if (m) paths.push(m[1])
  }
  return paths
}

async function fetchText (url) {
  const res = await fetch(url)
  if (!res.ok) return { ok: false, status: res.status }
  return { ok: true, text: await res.text() }
}

// DEPS entries of the plain form
//   'build': Var('chromium_url') + '/chromium/src/build.git' + '@' + '<sha>',
// as { dir, repo, rev }, longest dir first so the most specific one matches
let depsPins = null
async function getDepsPins () {
  if (depsPins) return depsPins
  const fetched = await fetchText(`${RAW_BASE}/${ref}/DEPS`)
  depsPins = []
  if (!fetched.ok) return depsPins
  const re = /'([^']+)':\s*Var\('chromium_url'\)\s*\+\s*'([^']+?)(?:\.git)?'\s*\+\s*'@'\s*\+\s*'([0-9a-f]{40})'/g
  for (const m of fetched.text.matchAll(re)) depsPins.push({ dir: m[1], repo: m[2], rev: m[3] })
  depsPins.sort((a, b) => b.dir.length - a.dir.length)
  return depsPins
}

// a target file's contents at this ref: from the v8/v8 mirror, or for a
// DEPS-pinned directory, from googlesource at the pinned revision
async function fetchTarget (path) {
  const pin = (await getDepsPins()).find(p => path.startsWith(p.dir + '/'))
  if (!pin) return fetchText(`${RAW_BASE}/${ref}/${path}`)
  const rest = path.slice(pin.dir.length + 1)
  const fetched = await fetchText(`https://chromium.googlesource.com${pin.repo}/+/${pin.rev}/${rest}?format=TEXT`)
  if (!fetched.ok) return { ok: false, status: `${fetched.status}, ${pin.dir} pinned by DEPS at ${pin.rev.slice(0, 12)}` }
  return { ok: true, text: Buffer.from(fetched.text, 'base64').toString('utf8') }
}

async function checkOnePatch (patchFile, scratchDir) {
  const patchPath = join(PATCHES_DIR, patchFile)
  const patchText = await (await import('node:fs/promises')).readFile(patchPath, 'utf8')
  const targets = targetPathsFromPatch(patchText)
  if (targets.length === 0) {
    return { patchFile, result: 'skip', detail: 'no "+++ b/<path>" target found in patch - not a plain -p1 diff?' }
  }

  const missing = []
  for (const path of targets) {
    const fetched = await fetchTarget(path)
    if (!fetched.ok) {
      missing.push(`${path} (HTTP ${fetched.status})`)
      continue
    }
    const dest = join(scratchDir, path)
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, fetched.text)
  }
  if (missing.length) {
    return { patchFile, result: 'fail', detail: `target file(s) not found at ${label}: ${missing.join(', ')}` }
  }

  try {
    execFileSync('git', ['apply', '--check', patchPath], { cwd: scratchDir, stdio: ['ignore', 'pipe', 'pipe'] })
    return { patchFile, result: 'pass' }
  } catch (err) {
    const detail = (err.stderr ? err.stderr.toString() : err.message).trim()
    return { patchFile, result: 'fail', detail }
  }
}

async function main () {
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(PATCHES_DIR)
  const patchFiles = entries.filter(f => f.endsWith('.patch')).sort()

  if (patchFiles.length === 0) {
    console.log('no patches/*.patch files found - nothing to check')
    return
  }

  console.log(`checking ${patchFiles.length} patch(es) against ${label}\n`)

  const scratchDir = await mkdtemp(join(tmpdir(), 'v8-check-patches-'))
  execFileSync('git', ['init', '-q'], { cwd: scratchDir })

  let anyFail = false
  for (const patchFile of patchFiles) {
    const { result, detail } = await checkOnePatch(patchFile, scratchDir)
    const label = result === 'pass' ? 'PASS' : result === 'skip' ? 'SKIP' : 'FAIL'
    console.log(`[${label}] ${patchFile}`)
    if (detail) console.log(`       ${detail.split('\n').join('\n       ')}`)
    if (result === 'fail') anyFail = true
  }

  await rm(scratchDir, { recursive: true, force: true })

  console.log()
  if (anyFail) {
    console.log(`one or more patches would NOT apply cleanly against ${label} - fix or retire them before bumping V8_VERSION`)
    process.exit(1)
  } else {
    console.log(`all patches apply cleanly against ${label}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
