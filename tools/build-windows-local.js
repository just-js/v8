#!/usr/bin/env node
// Local mirror of .github/workflows/build.yml's build-windows job, for
// testing a Windows-specific V8 change without waiting on/consuming a
// GitHub Actions run. Step-for-step the same depot_tools/gn/ninja
// sequence CI runs, including the real BUILD.gn source patches that step
// needs (see below) - see build.yml's build-windows job for the source
// of truth if the two ever drift.
//
// Usage: node tools/build-windows-local.js <x64|arm64> [v8-version]
//   e.g. node tools/build-windows-local.js x64
//        node tools/build-windows-local.js x64 15.2
//
// arm64 is accepted (args.win.arm64.gn exists) but genuinely untested -
// no CI job builds it either, this just doesn't block it artificially.
//
// PREREQUISITES, not automated here (unlike install-deps.sh's role on
// Linux) - a real Visual Studio install is too heavy/varied to script
// reliably: Visual Studio 2026 (or a compatible edition - build.yml
// switched to windows-2025/VS2026 2026-08-22, see its own comments for
// why) with the "Desktop development with C++" workload, plus git,
// python3, and curl on PATH. gn/ninja itself is bootstrapped by
// depot_tools below, same as every other platform - no separate install
// needed for those.
//
// UNVERIFIED END TO END as written - direct from build.yml's real steps,
// but never yet run for real (no Windows machine in this sandbox to test
// against). Please report back what actually happens on a real run.
//
// Doesn't call vcvars64.bat, unlike repos/lo's own build.cmd - that's
// not an oversight, the two need genuinely different things. build.cmd
// shells out to bare clang++ directly (no build system involved), so it
// has to bootstrap WindowsSdkDir/INCLUDE/LIB itself via vcvars64.bat,
// and separately needs install-llvm.cmd because vcvars64.bat's own
// bundled clang-cl is too old for V8's vendored libc++ floor. This
// script instead runs the real gn/ninja pipeline (same as build.yml),
// which does its own Visual Studio auto-detection internally as part of
// `gn gen` (gated by DEPOT_TOOLS_WIN_TOOLCHAIN=0 below, matching
// build.yml's own "setup env" step) and compiles with Chromium's own
// hermetic pinned clang regardless of what's on PATH - neither
// vcvars64.bat nor install-llvm.cmd apply to building V8 itself, only
// to a consumer like lo.cc's own separate compile step.
//
// Not yet run locally either: not tested against the two real BUILD.gn
// source patches below on a real gn/ninja toolchain - only confirmed
// they're byte-for-byte the same patch logic build.yml's own "patch
// v8_monolith to depend on libc++ explicitly" step already runs
// successfully in CI.
//
// Re-running is safe: depot_tools is reset (not re-cloned) if present,
// and the v8 checkout is force-checked-out back to branch-heads/<version>
// (undoing any previously-applied patches, including the two BUILD.gn
// patches below) before patches are re-applied.

import { existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const REPO_ROOT = new URL('..', import.meta.url).pathname
const PATCHES_DIR = join(REPO_ROOT, 'patches')
const DEPOT_TOOLS_DIR = join(REPO_ROOT, 'depot_tools')
const V8_DIR = join(REPO_ROOT, 'v8')

function usageAndExit () {
  console.error('usage: node tools/build-windows-local.js <x64|arm64> [v8-version]')
  process.exit(2)
}

const platform = process.argv[2]
if (platform !== 'x64' && platform !== 'arm64') usageAndExit()
const v8Version = process.argv[3] || '15.2'

if (process.platform !== 'win32') {
  console.error(`this must run on Windows (detected: ${process.platform})`)
  process.exit(1)
}

for (const bin of ['git', 'python3', 'curl']) {
  if (spawnSync('where', [bin]).status !== 0) {
    console.error(`missing prerequisite: ${bin} (not found via "where")`)
    console.error('install git, python3, and curl, and a Visual Studio 2026 install with the')
    console.error('"Desktop development with C++" workload, then re-run.')
    process.exit(1)
  }
}

function run (cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}${opts.cwd ? `  (in ${opts.cwd})` : ''}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...opts })
  if (result.status !== 0) {
    console.error(`\nfailed: ${cmd} ${args.join(' ')} (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
}

function runCapture (cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}${opts.cwd ? `  (in ${opts.cwd})` : ''}`)
  const result = spawnSync(cmd, args, { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', shell: true, ...opts })
  if (result.status !== 0) {
    console.error(`\nfailed: ${cmd} ${args.join(' ')} (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

const env = { ...process.env, PATH: `${DEPOT_TOOLS_DIR};${process.env.PATH}`, DEPOT_TOOLS_WIN_TOOLCHAIN: '0' }

// Git for Windows defaults to core.autocrlf=true, which would give the
// v8 checkout below CRLF line endings - patches/*.patch are plain LF
// (authored on a Linux sandbox), and `git apply` matches context
// byte-for-byte, so every patch fails to apply with CRLF. Real bug
// build.yml's own windows job hit and fixed the same way.
run('git', ['config', '--global', 'core.autocrlf', 'false'], { env })

// --- depot_tools ---
if (!existsSync(DEPOT_TOOLS_DIR)) {
  run('git', ['clone', 'https://chromium.googlesource.com/chromium/tools/depot_tools.git', DEPOT_TOOLS_DIR])
} else {
  run('git', ['-C', DEPOT_TOOLS_DIR, 'reset', '--hard'])
  run('git', ['-C', DEPOT_TOOLS_DIR, 'clean', '-fd'])
}
run('gclient', [], { cwd: REPO_ROOT, env })

// --- v8 checkout ---
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

// --- patch v8_monolith to depend on libc++ explicitly ---
// v8_monolith is a `static_library`, and Chromium's automatic libc++
// dependency injection (build/config/BUILD.gn's common_deps group) only
// applies to executable/shared_library/loadable_module targets - never
// static_library. Fine for a normal Chromium build (every static lib
// eventually links into a real executable within the same build, which
// is where libc++ gets pulled in) but v8_monolith is meant to be the
// final, self-contained artifact - nothing here ever triggers
// common_deps, so libc++'s compiled objects never become a real
// dependency at all, even though complete_static_lib would fold them in
// if they were. Without this: dozens of real LNK2019/LNK2001 unresolved
// externals for libc++ runtime symbols at final link time. Same patch
// build.yml's own windows job applies, byte-for-byte.
{
  const buildGnPath = join(V8_DIR, 'BUILD.gn')
  let content = readFileSync(buildGnPath, 'utf8')
  const re = /(v8_static_library\("v8_monolith"\)\s*\{\s*deps\s*=\s*\[[\s\S]*?"\/\/build\/win:default_exe_manifest",\s*\n\s*\])/
  const m = content.match(re)
  if (!m) {
    console.error('PATCH TARGET NOT FOUND - v8_monolith deps block has changed shape, aborting')
    process.exit(1)
  }
  content = content.replace(re, m[1] + '\n    if (use_custom_libcxx) {\n      deps += [ "//buildtools/third_party/libc++" ]\n    }')
  writeFileSync(buildGnPath, content)
  console.log('patched v8_monolith to depend on //buildtools/third_party/libc++ when use_custom_libcxx')
}

// --- second half: libc++'s own BUILD.gn restricts who can depend on it
// via GN's `visibility` mechanism - the deps addition above is
// syntactically fine but GN rejects it at `gn gen` without this too
// ("Dependency not allowed." at build/config/BUILDCONFIG.gn:556:5, real
// error hit in CI before this was added). v8_monolith is defined in
// V8_DIR's own top-level BUILD.gn, so its label is //:v8_monolith. ---
{
  const libcxxBuildGnPath = join(V8_DIR, 'buildtools/third_party/libc++/BUILD.gn')
  let content = readFileSync(libcxxBuildGnPath, 'utf8')
  const re = /(visibility\s*=\s*\[\s*"\/\/build\/config:common_deps",\s*\n\s*"\/\/third_party\/catapult\/devil",\s*\n\s*\])/
  const m = content.match(re)
  if (!m) {
    console.error('VISIBILITY PATCH TARGET NOT FOUND - libc++ BUILD.gn visibility block has changed shape, aborting')
    process.exit(1)
  }
  content = content.replace(re, m[1] + '\n  visibility += [ "//:v8_monolith" ]')
  writeFileSync(libcxxBuildGnPath, content)
  console.log('patched libc++ visibility to allow //:v8_monolith to depend on it')
}

// --- build ---
// Note: unlike build.yml's raw PowerShell (which does NOT propagate a
// native command's nonzero exit code as step failure by default - a real
// incident there let a genuine ninja failure through silently, needing
// explicit $LASTEXITCODE checks), spawnSync's returned status is checked
// directly by run() above for every command - no equivalent gap here.
const outDir = `out.gn/${platform}.release`
run('mkdir', [outDir], { cwd: V8_DIR, env })
run('copy', [join(REPO_ROOT, `args.win.${platform}.gn`), join(outDir, 'args.gn')], { cwd: V8_DIR, env })
run('gn', ['gen', outDir], { cwd: V8_DIR, env })
run('ninja', ['v8_monolith', '-C', outDir], { cwd: V8_DIR, env })
run('ninja', ['d8', '-C', outDir], { cwd: V8_DIR, env })
run('gn', ['args', '--list', outDir], { cwd: V8_DIR, env })

const compdb = runCapture('ninja', ['-C', outDir, '-t', 'compdb', 'cxx', 'cc'], { cwd: V8_DIR, env })
writeFileSync(join(REPO_ROOT, 'compile_commands.json'), compdb)

console.log(`\nbuilt: ${join(V8_DIR, outDir, 'obj/v8_monolith.lib')}`)
console.log(`built: ${join(V8_DIR, outDir, 'd8.exe')}`)
console.log(`wrote: ${join(REPO_ROOT, 'compile_commands.json')}`)
