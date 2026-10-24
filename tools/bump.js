#!/usr/bin/env node
// Pin the V8 build to a version and exact commit: set V8_VERSION and
// V8_COMMIT in .github/workflows/build.yml (and the release links in
// README.md when the version changes), commit only those two files, and
// push main, which starts the push build (push.yml). Node 20+, no
// dependencies.
//
// usage: node tools/bump.js [--dry-run] [--commit <sha>] <version>
//   e.g. node tools/bump.js 15.7
//
//   --commit   the V8 commit to pin. Default: Chrome's newest Stable release
//              for the milestone (V8 x.y = milestone xy), or its newest Beta
//              if it isn't on Stable yet, from chromiumdash.appspot.com
//   --dry-run  do every check and show the diff; commit and push nothing,
//              and leave the working tree as it was
//
// The same version with a different commit is a re-pin (e.g. from the
// Beta/Stable Cut build to the Stable one). The commit must be on
// branch-heads/<version> (checked on GitHub's v8/v8 mirror). Edits already
// made are fine as long as they are exactly that bump: each file must equal
// HEAD's copy with the bump applied, so nothing else rides along. Refuses
// unless on main, level with origin/main, with nothing staged.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const YML = '.github/workflows/build.yml'
const README = 'README.md'
const DASH = 'https://chromiumdash.appspot.com/fetch_releases?platform=Linux&num=20&channel='

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

const ghHeaders = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
if (token) ghHeaders.Authorization = `Bearer ${token}`

async function getJson (url, headers = {}) {
  const res = await fetch(url, { headers })
  if (!res.ok) fail(`GET ${url}: HTTP ${res.status}`)
  return res.json()
}

// Chrome's newest Stable (else Beta) release for a milestone: { sha, chrome, channel }
async function chromeRelease (milestone) {
  for (const channel of ['Stable', 'Beta']) {
    const list = (await getJson(DASH + channel)).filter(r => r.milestone === milestone)
    if (list.length) return { sha: list[0].hashes.v8, chrome: list[0].version, channel }
  }
  fail(`no Stable or Beta Chrome release for milestone ${milestone} on chromiumdash yet`)
}

// parse args
const args = process.argv.slice(2)
let dryRun = false
let commitArg = null
const rest = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') dryRun = true
  else if (args[i] === '--commit') commitArg = args[++i]
  else if (args[i].startsWith('--')) rest.push(null)
  else rest.push(args[i])
}
const [version] = rest
if (rest.length !== 1 || !/^\d+\.\d+$/.test(version || '') || (commitArg !== null && !/^[0-9a-f]{40}$/.test(commitArg))) {
  fail('usage: node tools/bump.js [--dry-run] [--commit <40-char sha>] <version>   (e.g. 15.7)')
}

if (git('branch', '--show-current') !== 'main') fail('not on main')
git('fetch', '-q', 'origin')
if (git('rev-parse', 'main') !== git('rev-parse', 'origin/main')) {
  fail('local main is not origin/main; pull or push first')
}
const staged = git('diff', '--cached', '--name-only')
if (staged) fail(`changes are staged; unstage them first:\n${staged}`)

const headYml = headFile(YML)
const curVersion = (headYml.match(/^ *V8_VERSION: *"([^"]*)"/m) || [])[1]
const curCommit = (headYml.match(/^ *V8_COMMIT: *"([0-9a-f]{40})"/m) || [])[1]
if (!curVersion) fail(`no V8_VERSION in HEAD's ${YML}`)
if (!curCommit) fail(`no V8_COMMIT in HEAD's ${YML} (the pinned-commit build.yml isn't committed yet)`)
const cmp = compareVersions(version, curVersion)
if (cmp < 0) fail(`main builds ${curVersion}; ${version} is older`)

// the commit to pin, and what it is
const [major, minor] = version.split('.').map(Number)
const milestone = major * 10 + minor
let sha = commitArg
let source = ''
if (!sha) {
  const rel = await chromeRelease(milestone)
  sha = rel.sha
  source = `, Chrome ${rel.chrome} ${rel.channel}`
}
if (cmp === 0 && sha === curCommit) fail(`main already builds ${version} at ${sha}; nothing to bump`)

const cmpRes = await getJson(`https://api.github.com/repos/v8/v8/compare/${sha}...branch-heads/${version}`, ghHeaders)
if (cmpRes.status !== 'ahead' && cmpRes.status !== 'identical') {
  fail(`${sha} is not on branch-heads/${version} (compare: ${cmpRes.status})`)
}
const message = (await getJson(`https://api.github.com/repos/v8/v8/commits/${sha}`, ghHeaders)).commit.message
const v8Full = (message.match(/^Version (\d+\.\d+\.\d+\.\d+)/) || [])[1] || sha.slice(0, 12)
const behind = cmpRes.ahead_by ? `, ${cmpRes.ahead_by} commit(s) behind the branch head` : ''
console.log(`${version}: pinning ${sha} (${v8Full}${source}${behind})`)

const curRe = curVersion.replace('.', '\\.')
const bumps = {
  [YML]: text => text
    .replace(new RegExp(`^( *V8_VERSION: *")${curRe}"`, 'm'), `$1${version}"`)
    .replace(/^( *V8_COMMIT: *)"[0-9a-f]{40}".*$/m, `$1"${sha}" # ${v8Full}${source}`),
  [README]: text => cmp === 0 ? text : text.replace(new RegExp(`releases/(tag|download)/${curRe}([/)])`, 'g'), `releases/$1/${version}$2`)
}

// apply the bump (a no-op where it's already done) and require each file to
// come out exactly as HEAD's copy with the bump applied; write nothing unless
// both do
const original = {}
const bumped = {}
for (const [path, bump] of Object.entries(bumps)) {
  original[path] = readFileSync(path, 'utf8')
  bumped[path] = bump(original[path])
  if (bumped[path] !== bump(headFile(path))) {
    fail(`${path} has changes besides the bump:\n${git('diff', '--', path)}`)
  }
}
for (const [path, text] of Object.entries(bumped)) {
  if (text !== original[path]) writeFileSync(path, text)
}

const what = cmp === 0 ? `re-pin ${version} to ${v8Full}` : `${curVersion} -> ${version} (${v8Full})`
const subject = `chore: v8 ${version} (${v8Full})`
if (dryRun) {
  console.log(git('diff', '--', YML, README))
  for (const [path, text] of Object.entries(original)) writeFileSync(path, text)
  console.log(`would commit "${subject}" (${what}) and push main; working tree restored`)
  process.exit(0)
}

git('add', '--', YML, README)
git('commit', '-q', '-m', subject)
git('push', '-q', 'origin', 'main')
const repo = git('remote', 'get-url', 'origin').match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/)[1]
console.log(`${what}: pushed ${git('rev-parse', '--short', 'HEAD')} to main`)
console.log(`push build: https://github.com/${repo}/actions/workflows/push.yml`)
