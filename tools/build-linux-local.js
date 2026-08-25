#!/usr/bin/env node
// Local mirror of .github/workflows/build.yml's build-linux-x64/
// build-linux-arm64 jobs, for testing a linux-specific V8 change without
// waiting on/consuming a GitHub Actions run. Step-for-step the same
// depot_tools/gn/ninja sequence CI runs - see those jobs for the source
// of truth if the two ever drift.
//
// Usage: node tools/build-linux-local.js <x64|arm64> [v8-version]
//   e.g. node tools/build-linux-local.js x64
//        node tools/build-linux-local.js arm64 15.2
//
// arm64 is genuinely more expensive than x64, not just a flag flip:
// Chromium only publishes a prebuilt hermetic clang for x64 hosts, so
// arm64 has to bootstrap its own clang from source first (real CI step
// "build bootstrap clang", ~tools/clang/scripts/build.py) before it can
// even run `gn gen`. That bootstrap build is cached here the same way
// CI caches it (keyed off v8/tools/clang/scripts/update.py's hash) -
// skipped on a re-run against the same v8 checkout, but expect it to
// take a long time (compiling LLVM/clang from source) the first time.
//
// --libcxx: not implemented. This session's toolchain-matrix work
// (LO.md) surfaced that Linux still links system libstdc++
// (use_custom_libcxx=false), a flag Chromium's own tree marks deprecated
// and slated for removal - PLAN.md task 38 is the rescoped plan for
// adding a real libc++ build option here, not yet built. This flag is
// wired up as a placeholder so the CLI shape doesn't need to change
// later, and fails clearly rather than silently building libstdc++
// anyway if passed.
//
// Re-running is safe: depot_tools is reset (not re-cloned) if present,
// and the v8 checkout is force-checked-out back to branch-heads/<version>
// (undoing any previously-applied patches) before patches are re-applied.

import { existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const REPO_ROOT = new URL('..', import.meta.url).pathname
const PATCHES_DIR = join(REPO_ROOT, 'patches')
const DEPOT_TOOLS_DIR = join(REPO_ROOT, 'depot_tools')
const V8_DIR = join(REPO_ROOT, 'v8')

function usageAndExit () {
  console.error('usage: node tools/build-linux-local.js <x64|arm64> [v8-version] [--libcxx]')
  process.exit(2)
}

const rawArgs = process.argv.slice(2)
const useLibcxx = rawArgs.includes('--libcxx')
const positional = rawArgs.filter(a => a !== '--libcxx')

const platform = positional[0]
if (platform !== 'x64' && platform !== 'arm64') usageAndExit()
const v8Version = positional[1] || '15.2'

if (process.platform !== 'linux') {
  console.error(`this must run on Linux (detected: ${process.platform})`)
  process.exit(1)
}

if (useLibcxx) {
  console.error('--libcxx is not implemented yet - repos/v8 has no args.linux.*-libcxx.gn')
  console.error('variant, and Linux always builds against system libstdc++ today.')
  console.error('See PLAN.md task 38 (this repo\'s docs) for the rescoped plan.')
  process.exit(1)
}

// Fails fast and clearly here rather than partway through a `fetch v8`/
// `gclient sync` with a confusing "command not found" - install-deps.sh
// covers all of these.
for (const bin of ['git', 'python3', 'curl', 'gcc']) {
  if (spawnSync('which', [bin]).status !== 0) {
    console.error(`missing prerequisite: ${bin}`)
    console.error('run ./install-deps.sh first (repos/v8 root)')
    process.exit(1)
  }
}

function run (cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}${opts.cwd ? `  (in ${opts.cwd})` : ''}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (result.status !== 0) {
    console.error(`\nfailed: ${cmd} ${args.join(' ')} (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
}

function runCapture (cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}${opts.cwd ? `  (in ${opts.cwd})` : ''}`)
  const result = spawnSync(cmd, args, { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', ...opts })
  if (result.status !== 0) {
    console.error(`\nfailed: ${cmd} ${args.join(' ')} (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

const env = { ...process.env, PATH: `${DEPOT_TOOLS_DIR}:${process.env.PATH}` }

// --- depot_tools ---
if (!existsSync(DEPOT_TOOLS_DIR)) {
  run('git', ['clone', 'https://chromium.googlesource.com/chromium/tools/depot_tools.git', DEPOT_TOOLS_DIR])
} else {
  run('git', ['-C', DEPOT_TOOLS_DIR, 'reset', '--hard'])
  run('git', ['-C', DEPOT_TOOLS_DIR, 'clean', '-fd'])
}
run('gclient', [], { cwd: REPO_ROOT, env })

// --- v8 checkout ---
// gclient defaults to 16 parallel jobs - real-machine gsutil lockfile
// contention under that many concurrent third_party dep syncs is a known
// flaky spot (confirmed hit locally on macOS, same depot_tools mechanism
// applies here) - lower by default, override with GCLIENT_JOBS. Always
// (not just on a fresh clone) re-run sync: a prior interrupted run can
// leave V8_DIR present with its own sync incomplete, silently missing
// DEPS-fetched tools - real bug hit and fixed in build-mac-local.js,
// same fix applies here.
const gclientJobs = process.env.GCLIENT_JOBS || '4'
if (!existsSync(V8_DIR)) {
  run('fetch', ['v8'], { cwd: REPO_ROOT, env })
  run('git', ['checkout', `branch-heads/${v8Version}`], { cwd: V8_DIR, env })
} else {
  console.log(`\n${V8_DIR} already exists - resetting to a clean branch-heads/${v8Version} instead of re-fetching`)
  run('git', ['checkout', '-f', `branch-heads/${v8Version}`], { cwd: V8_DIR, env })
  run('git', ['clean', '-fd'], { cwd: V8_DIR, env })
}
run('gclient', ['sync', '-j', gclientJobs], { cwd: V8_DIR, env })

// --- patches ---
const patches = existsSync(PATCHES_DIR)
  ? readdirSync(PATCHES_DIR).filter(f => f.endsWith('.patch')).sort()
  : []
for (const patch of patches) {
  console.log(`applying ${patch}`)
  run('git', ['apply', join(PATCHES_DIR, patch)], { cwd: V8_DIR, env })
}

// --- install-build-deps (both platforms, matches CI) ---
// V8's own script, apt-based - real gap for a musl/Alpine container
// (docker/Dockerfile.alpine), which has no apt-get at all. Skip with a
// clear warning there rather than a confusing mid-script crash; an
// Alpine image is expected to provide its own equivalent packages up
// front instead (see Dockerfile.alpine's own comments for what's known
// to be missing/untested this way - this is genuinely unproven territory,
// not a solved substitution).
if (spawnSync('which', ['apt-get']).status === 0) {
  run('bash', ['./build/install-build-deps.sh'], { cwd: V8_DIR, env })
} else {
  console.log('\napt-get not found - skipping v8/build/install-build-deps.sh')
  console.log('(expected on a non-Debian/Ubuntu host, e.g. Alpine - see docker/Dockerfile.alpine)')
}

// --- arm64 only: bootstrap clang from source, cached by update.py's hash
// (same cache key shape as CI's actions/cache, just a local directory
// instead) - this is the expensive step, real LLVM/clang compile ---
if (platform === 'arm64') {
  const updatePyPath = join(V8_DIR, 'tools/clang/scripts/update.py')
  const hash = createHash('sha256').update(readFileSync(updatePyPath)).digest('hex').slice(0, 16)
  const bootstrapStamp = join(REPO_ROOT, `.bootstrap-clang-arm64-${hash}.stamp`)
  if (existsSync(bootstrapStamp)) {
    console.log(`\nbootstrap clang already built for this tools/clang/scripts/update.py (${hash}) - skipping`)
  } else {
    console.log('\nbuilding bootstrap clang from source (arm64 has no prebuilt hermetic clang) - this is slow')
    const gccEnv = { ...env, CC: 'gcc', CXX: 'g++', VPYTHON_BYPASS: 'manually managed python not supported by chrome operations' }
    run('python3', [
      './tools/clang/scripts/build.py',
      '--without-android', '--host-cc=gcc', '--host-cxx=g++', '--without-fuchsia',
      '--use-system-cmake', '--disable-asserts', '--with-ml-inliner-model=', '--no-tools'
    ], { cwd: V8_DIR, env: gccEnv })
    writeFileSync(bootstrapStamp, '')
  }
}

// --- build ---
const outDir = `out.gn/linux.${platform}.release`
run('mkdir', ['-p', outDir], { cwd: V8_DIR, env })
run('cp', [join(REPO_ROOT, `args.linux.${platform}.gn`), join(outDir, 'args.gn')], { cwd: V8_DIR, env })
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
