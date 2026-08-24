#!/usr/bin/env node
// Local mirror of .github/workflows/build.yml's build-mac job, for testing
// a mac-specific build.gn/build.yml change on real Mac hardware without
// waiting on/consuming a GitHub Actions run. Step-for-step the same
// depot_tools/gn/ninja sequence CI runs - see build.yml's build-mac job
// for the source of truth if the two ever drift.
//
// Usage: node tools/build-mac-local.js <x64|arm64> [v8-version]
//   e.g. node tools/build-mac-local.js arm64
//        node tools/build-mac-local.js arm64 15.1
//
// Re-running is safe: depot_tools is reset (not re-cloned) if present,
// and the v8 checkout is force-checked-out back to branch-heads/<version>
// (undoing any previously-applied patches) before patches are re-applied,
// so repeated runs start from the same clean state CI would.

import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'

const REPO_ROOT = new URL('..', import.meta.url).pathname
const PATCHES_DIR = join(REPO_ROOT, 'patches')
const DEPOT_TOOLS_DIR = join(REPO_ROOT, 'depot_tools')
const V8_DIR = join(REPO_ROOT, 'v8')

// Matches build.yml's build-mac job env - keep in sync if that changes.
const DEFAULT_DEVELOPER_DIR = '/Applications/Xcode_16.4.app/Contents/Developer'

function usageAndExit () {
  console.error('usage: node tools/build-mac-local.js <x64|arm64> [v8-version]')
  process.exit(2)
}

const platform = process.argv[2]
if (platform !== 'x64' && platform !== 'arm64') usageAndExit()
const v8Version = process.argv[3] || '15.1'

if (process.platform !== 'darwin') {
  console.error(`this must run on macOS (detected: ${process.platform})`)
  process.exit(1)
}

function run (cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}${opts.cwd ? `  (in ${opts.cwd})` : ''}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (result.status !== 0) {
    console.error(`\nfailed: ${cmd} ${args.join(' ')} (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
}

const env = {
  ...process.env,
  PATH: `${DEPOT_TOOLS_DIR}:${process.env.PATH}`,
  DEVELOPER_DIR: process.env.DEVELOPER_DIR || DEFAULT_DEVELOPER_DIR
}
console.log(`DEVELOPER_DIR=${env.DEVELOPER_DIR}`)

// --- depot_tools ---
if (!existsSync(DEPOT_TOOLS_DIR)) {
  run('git', ['clone', 'https://chromium.googlesource.com/chromium/tools/depot_tools.git', DEPOT_TOOLS_DIR])
} else {
  run('git', ['-C', DEPOT_TOOLS_DIR, 'reset', '--hard'])
  run('git', ['-C', DEPOT_TOOLS_DIR, 'clean', '-fd'])
}
run('gclient', [], { cwd: REPO_ROOT, env })

// --- v8 checkout ---
if (!existsSync(V8_DIR)) {
  run('fetch', ['v8'], { cwd: REPO_ROOT, env })
  run('git', ['checkout', `branch-heads/${v8Version}`], { cwd: V8_DIR, env })
  run('gclient', ['sync'], { cwd: V8_DIR, env })
} else {
  console.log(`\n${V8_DIR} already exists - resetting to a clean branch-heads/${v8Version} instead of re-fetching`)
  run('git', ['checkout', '-f', `branch-heads/${v8Version}`], { cwd: V8_DIR, env })
  run('git', ['clean', '-fd'], { cwd: V8_DIR, env })
}

// --- patches ---
const patches = existsSync(PATCHES_DIR)
  ? readdirSync(PATCHES_DIR).filter(f => f.endsWith('.patch')).sort()
  : []
for (const patch of patches) {
  console.log(`applying ${patch}`)
  run('git', ['apply', join(PATCHES_DIR, patch)], { cwd: V8_DIR, env })
}

// --- build ---
const outDir = `out.gn/${platform}.release`
run('mkdir', ['-p', outDir], { cwd: V8_DIR, env })
run('cp', [join(REPO_ROOT, `args.mac.${platform}.gn`), join(outDir, 'args.gn')], { cwd: V8_DIR, env })
run('gn', ['gen', outDir], { cwd: V8_DIR, env })
run('ninja', ['v8_monolith', '-C', outDir], { cwd: V8_DIR, env })
run('gn', ['args', '--list', outDir], { cwd: V8_DIR, env })

console.log(`\nbuilt: ${join(V8_DIR, outDir, 'obj/libv8_monolith.a')}`)
