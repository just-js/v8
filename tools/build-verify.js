#!/usr/bin/env node
// Downloads a real just-js/lo checkout and builds it against this repo's
// own freshly-built V8 (from build-mac-local.js's out.gn/<platform>.release
// output), running the same checks build.yml's build-mac job's "sanity
// test" steps do (stage v8, build lo, run its smoke test) - so a local V8
// change can be verified end-to-end against a real lo build without
// waiting on/consuming a GitHub Actions run.
//
// Usage: node tools/build-verify.js <x64|arm64> [lo-ref] [--check]
//   e.g. node tools/build-verify.js arm64            # lo@main
//        node tools/build-verify.js arm64 my-branch
//        node tools/build-verify.js arm64 3f9a1c2     # a commit sha
//        node tools/build-verify.js arm64 main --check
//
// --check additionally runs `make check` (lo's own runtime sanity tests)
// and `make check-build` (test/build.js) - real lo test suites, broader
// than the single eval smoke test, off by default since they're slower.
//
// macOS only for now (matches build-mac-local.js's own scope, and the
// build-mac job's non-Docker "build lo directly on the runner" path) -
// the linux/windows jobs' own sanity-test steps use Docker and
// PowerShell/build.cmd respectively, different enough to be their own
// follow-up rather than shoehorned in here.
//
// lo-verify/ is a scratch checkout this script owns entirely (a fresh
// tarball extraction every run, like CI's own checkout step) - safe to
// delete, and deleted/recreated on every run rather than reused.

import { existsSync, rmSync, mkdirSync, cpSync, copyFileSync, closeSync, openSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = new URL('..', import.meta.url).pathname
const V8_DIR = join(REPO_ROOT, 'v8')
const LO_VERIFY_DIR = join(REPO_ROOT, 'lo-verify')

function usageAndExit () {
  console.error('usage: node tools/build-verify.js <x64|arm64> [lo-ref] [--check]')
  process.exit(2)
}

const rawArgs = process.argv.slice(2)
const runCheck = rawArgs.includes('--check')
const positional = rawArgs.filter(a => a !== '--check')

const platform = positional[0]
if (platform !== 'x64' && platform !== 'arm64') usageAndExit()
const loRef = positional[1] || 'main'

if (process.platform !== 'darwin') {
  console.error(`this must run on macOS (detected: ${process.platform}) - see the header comment for why linux/windows aren't supported here yet`)
  process.exit(1)
}

const outDir = join(V8_DIR, `out.gn/${platform}.release`)
const monolith = join(outDir, 'obj/libv8_monolith.a')
if (!existsSync(monolith)) {
  console.error(`no v8 build found at ${monolith}`)
  console.error(`run tools/build-mac-local.js ${platform} first`)
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

function runCapture (cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}${opts.cwd ? `  (in ${opts.cwd})` : ''}`)
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (result.status !== 0) {
    console.error(result.stdout || '')
    console.error(result.stderr || '')
    console.error(`\nfailed: ${cmd} ${args.join(' ')} (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

// --- fetch lo@<loRef> ---
// GitHub's /archive/<ref>.tar.gz endpoint accepts a branch, tag, or full
// commit sha uniformly (redirects to codeload.github.com either way) -
// no need to special-case which kind of ref this is.
console.log(`\nfetching just-js/lo@${loRef}...`)
const tarPath = join(tmpdir(), `lo-${loRef.replace(/[^A-Za-z0-9._-]/g, '_')}-${Date.now()}.tar.gz`)
run('curl', ['-sL', '-f', '-o', tarPath, `https://github.com/just-js/lo/archive/${loRef}.tar.gz`])

if (existsSync(LO_VERIFY_DIR)) rmSync(LO_VERIFY_DIR, { recursive: true, force: true })
mkdirSync(LO_VERIFY_DIR, { recursive: true })
run('tar', ['-xzf', tarPath, '-C', LO_VERIFY_DIR, '--strip-components=1'])
rmSync(tarPath, { force: true })

if (!existsSync(join(LO_VERIFY_DIR, 'lo.cc'))) {
  console.error(`extracted lo checkout is missing lo.cc - bad ref (${loRef}) or extraction failed`)
  process.exit(1)
}

// --- stage this repo's freshly-built v8, same shape as build.yml's
// "stage freshly-built v8 for lo (sanity test)" step for build-mac ---
console.log(`\nstaging v8 (${platform}) into lo-verify/v8...`)
const loV8Dir = join(LO_VERIFY_DIR, 'v8')
mkdirSync(loV8Dir, { recursive: true })
cpSync(join(V8_DIR, 'include'), join(loV8Dir, 'include'), { recursive: true })
closeSync(openSync(join(loV8Dir, '.stamp'), 'w'))
closeSync(openSync(join(loV8Dir, 'include/.stamp'), 'w'))
copyFileSync(monolith, join(loV8Dir, 'libv8_monolith.a'))

// --- build lo, same as CI's "build lo against freshly-built v8" step ---
run('brew', ['install', 'lz4', 'zstd', 'openssl@3'])
run('make', ['ARCH=' + platform, 'lo'], { cwd: LO_VERIFY_DIR })
if (!existsSync(join(LO_VERIFY_DIR, 'lo'))) {
  console.error('lo was not produced')
  process.exit(1)
}

// --- smoke test, same checks as CI's "run lo smoke test" step (exit
// code AND actual output - a linked binary that doesn't run is a
// different failure than one that never got produced) ---
const smokeOut = runCapture('./lo', ['eval', 'console.log("hello")'], { cwd: LO_VERIFY_DIR })
if (!smokeOut.includes('hello')) {
  console.error('lo eval ran but did not print the expected output')
  console.error(smokeOut)
  process.exit(1)
}

console.log('\nsmoke test passed:')
console.log(smokeOut.trim())

// --- optional: lo's own real test suites ---
if (runCheck) {
  run('make', ['check'], { cwd: LO_VERIFY_DIR })
  run('make', ['check-build'], { cwd: LO_VERIFY_DIR })
}

console.log(`\nlo built and verified: ${join(LO_VERIFY_DIR, 'lo')} (lo@${loRef} against this repo's v8/${platform})`)
