#!/usr/bin/env node
// Local mirror of .github/workflows/build.yml's build-mac job, for testing
// a mac-specific build.gn/build.yml change on real Mac hardware without
// waiting on/consuming a GitHub Actions run. Step-for-step the same
// depot_tools/gn/ninja sequence CI runs - see build.yml's build-mac job
// for the source of truth if the two ever drift.
//
// Usage: node tools/build-mac-local.js <x64|arm64> [v8-version]
//   e.g. node tools/build-mac-local.js arm64
//        node tools/build-mac-local.js arm64 15.2
//
// Re-running is safe: depot_tools is reset (not re-cloned) if present,
// and the v8 checkout is force-checked-out back to branch-heads/<version>
// (undoing any previously-applied patches) before patches are re-applied,
// so repeated runs start from the same clean state CI would.

import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'

const REPO_ROOT = new URL('..', import.meta.url).pathname
const PATCHES_DIR = join(REPO_ROOT, 'patches')
const DEPOT_TOOLS_DIR = join(REPO_ROOT, 'depot_tools')
const V8_DIR = join(REPO_ROOT, 'v8')

function usageAndExit () {
  console.error('usage: node tools/build-mac-local.js <x64|arm64> [v8-version]')
  process.exit(2)
}

const platform = process.argv[2]
if (platform !== 'x64' && platform !== 'arm64') usageAndExit()
const v8Version = process.argv[3] || '15.2'

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

// Same as run(), but returns captured stdout instead of streaming it -
// for commands whose output we need to write to a file (e.g. `-t compdb`).
function runCapture (cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}${opts.cwd ? `  (in ${opts.cwd})` : ''}`)
  const result = spawnSync(cmd, args, { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', ...opts })
  if (result.status !== 0) {
    console.error(`\nfailed: ${cmd} ${args.join(' ')} (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

// Unlike build.yml's build-mac job (which pins a specific GitHub-runner-
// image path, e.g. /Applications/Xcode_16.4.app - a CI-image-only naming
// convention), this script doesn't force a DEVELOPER_DIR by default: a
// normal Mac just has one /Applications/Xcode.app, and hardcoding a
// versioned CI path here broke even depot_tools' own `gclient` bootstrap
// (its xcrun calls) before the real V8 build steps were reached. Set
// DEVELOPER_DIR yourself in the environment if you want to pin a specific
// Xcode; otherwise this uses whatever `xcode-select` already resolves.
const env = {
  ...process.env,
  PATH: `${DEPOT_TOOLS_DIR}:${process.env.PATH}`
}
if (env.DEVELOPER_DIR) {
  console.log(`DEVELOPER_DIR=${env.DEVELOPER_DIR} (from environment)`)
} else {
  const xcodeSelect = spawnSync('xcode-select', ['-p'], { encoding: 'utf8' })
  console.log(`DEVELOPER_DIR not set - using xcode-select's default: ${xcodeSelect.stdout?.trim() || '(unknown)'}`)
}

// --- depot_tools ---
if (!existsSync(DEPOT_TOOLS_DIR)) {
  run('git', ['clone', 'https://chromium.googlesource.com/chromium/tools/depot_tools.git', DEPOT_TOOLS_DIR])
} else {
  run('git', ['-C', DEPOT_TOOLS_DIR, 'reset', '--hard'])
  run('git', ['-C', DEPOT_TOOLS_DIR, 'clean', '-fd'])
}
run('gclient', [], { cwd: REPO_ROOT, env })

// --- v8 checkout ---
// gclient defaults to 16 parallel jobs - fine for CI's network/disk, but
// real-machine `gsutil` lockfile contention under that many concurrent
// third_party dep syncs is a known flaky spot depot_tools itself has open
// issues about (confirmed hit locally: BlockingIOError on
// depot_tools/external_bin/gsutil's lockfile). Lower by default here;
// override with GCLIENT_JOBS if this machine can handle more (or needs
// fewer). Only applied to this script's own explicit sync below - not to
// `fetch v8`'s first sync, since it's unconfirmed whether depot_tools'
// `fetch` wrapper forwards -j through to the gclient sync it runs
// internally.
const gclientJobs = process.env.GCLIENT_JOBS || '4'
if (!existsSync(V8_DIR)) {
  run('fetch', ['v8'], { cwd: REPO_ROOT, env })
  run('git', ['checkout', `branch-heads/${v8Version}`], { cwd: V8_DIR, env })
} else {
  console.log(`\n${V8_DIR} already exists - resetting to a clean branch-heads/${v8Version} instead of re-fetching`)
  run('git', ['checkout', '-f', `branch-heads/${v8Version}`], { cwd: V8_DIR, env })
  run('git', ['clean', '-fd'], { cwd: V8_DIR, env })
}
// Always (not just on a fresh clone): `gclient sync` is meant to be safely
// re-runnable, no-opping on anything already up to date - and skipping it
// here on a pre-existing V8_DIR is a real bug this session hit for real:
// a prior run's `fetch v8` can leave V8_DIR present but its own internal
// sync incomplete (e.g. the gsutil lock contention above), silently
// missing DEPS-fetched tools like buildtools/mac/gn/gn - `gn gen` then
// fails with a confusing "could not find gn executable", not an obvious
// sync error.
run('gclient', ['sync', '-j', gclientJobs], { cwd: V8_DIR, env })

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
run('ninja', ['d8', '-C', outDir], { cwd: V8_DIR, env })
run('gn', ['args', '--list', outDir], { cwd: V8_DIR, env })

// compile_commands.json, for editor tooling (clangd etc) - regenerated
// from scratch each run, so it always matches whatever's in outDir now.
const compdb = runCapture('ninja', ['-C', outDir, '-t', 'compdb', 'cxx', 'cc'], { cwd: V8_DIR, env })
writeFileSync(join(REPO_ROOT, 'compile_commands.json'), compdb)

console.log(`\nbuilt: ${join(V8_DIR, outDir, 'obj/libv8_monolith.a')}`)
console.log(`built: ${join(V8_DIR, outDir, 'd8')}`)
console.log(`wrote: ${join(REPO_ROOT, 'compile_commands.json')}`)
