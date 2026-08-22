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
// Usage: node tools/check-patches.js <v8-version>
//   e.g. node tools/check-patches.js 14.9

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const REPO_ROOT = new URL('..', import.meta.url).pathname
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

async function checkOnePatch (patchFile, scratchDir) {
  const patchPath = join(PATCHES_DIR, patchFile)
  const patchText = await (await import('node:fs/promises')).readFile(patchPath, 'utf8')
  const targets = targetPathsFromPatch(patchText)
  if (targets.length === 0) {
    return { patchFile, result: 'skip', detail: 'no "+++ b/<path>" target found in patch - not a plain -p1 diff?' }
  }

  const missing = []
  for (const path of targets) {
    const url = `${RAW_BASE}/${ref}/${path}`
    const fetched = await fetchText(url)
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
