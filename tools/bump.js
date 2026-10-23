#!/usr/bin/env node
// Bump V8_VERSION in .github/workflows/build.yml and the release links in
// README.md, commit only those two files as "chore: v8 <version>", and push
// main, which starts the push build (push.yml). Node 20+, no dependencies.
//
// usage: node tools/bump.js [--dry-run] <version>
//   e.g. node tools/bump.js 15.6
//
//   --dry-run  do every check and show the diff, commit and push nothing
//              (the bump is left in the working tree)
//
// Already-made edits are fine, as long as they are exactly that bump: each
// file must equal HEAD's copy with the bump applied, so nothing else rides
// along. Refuses unless on main, level with origin/main, with nothing staged.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const YML = '.github/workflows/build.yml'
const README = 'README.md'

function fail (msg) {
  console.error(msg)
  process.exit(1)
}

function git (...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

// HEAD's copy of a file, byte for byte (git() trims)
function headFile (path) {
  return execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' })
}

function compareVersions (a, b) {
  const [a1, a2] = a.split('.').map(Number)
  const [b1, b2] = b.split('.').map(Number)
  return a1 - b1 || a2 - b2
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const [version] = args.filter(a => !a.startsWith('--'))
if (!version || !/^\d+\.\d+$/.test(version) || args.some(a => a.startsWith('--') && a !== '--dry-run')) {
  fail('usage: node tools/bump.js [--dry-run] <version>   (e.g. 15.6)')
}

if (git('branch', '--show-current') !== 'main') fail('not on main')
git('fetch', '-q', 'origin')
if (git('rev-parse', 'main') !== git('rev-parse', 'origin/main')) {
  fail('local main is not origin/main; pull or push first')
}
const staged = git('diff', '--cached', '--name-only')
if (staged) fail(`changes are staged; unstage them first:\n${staged}`)

const m = headFile(YML).match(/^ *V8_VERSION: *"([^"]*)"/m)
if (!m) fail(`no V8_VERSION in HEAD's ${YML}`)
const current = m[1]
if (compareVersions(version, current) <= 0) fail(`main builds ${current}; ${version} is not newer`)

const cur = current.replace('.', '\\.')
const bumps = {
  [YML]: text => text.replace(new RegExp(`^( *V8_VERSION: *")${cur}"`, 'm'), `$1${version}"`),
  [README]: text => text.replace(new RegExp(`releases/(tag|download)/${cur}([/)])`, 'g'), `releases/$1/${version}$2`)
}

// apply the bump (a no-op where it's already done) and require each file to
// come out exactly as HEAD's copy with the bump applied; write nothing unless
// both do
const bumped = {}
for (const [path, bump] of Object.entries(bumps)) {
  bumped[path] = bump(readFileSync(path, 'utf8'))
  if (bumped[path] !== bump(headFile(path))) {
    fail(`${path} has changes besides the ${current} -> ${version} bump:\n${git('diff', '--', path)}`)
  }
}
for (const [path, text] of Object.entries(bumped)) {
  if (text !== readFileSync(path, 'utf8')) writeFileSync(path, text)
}
if (!git('diff', '--name-only', '--', YML)) fail(`${YML} still builds ${current}`)

if (dryRun) {
  console.log(git('diff', '--stat', '--', YML, README))
  console.log(`would commit "chore: v8 ${version}" (${current} -> ${version}) and push main; the bump is left in the working tree`)
  process.exit(0)
}

git('add', '--', YML, README)
git('commit', '-q', '-m', `chore: v8 ${version}`)
git('push', '-q', 'origin', 'main')
console.log(`bumped ${current} -> ${version}, pushed ${git('rev-parse', '--short', 'HEAD')} to main`)
console.log(`push build: https://github.com/${git('remote', 'get-url', 'origin').match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/)[1]}/actions/workflows/push.yml`)
