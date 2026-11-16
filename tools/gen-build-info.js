#!/usr/bin/env node
// Write <v8>/<out>/gen/build-info/: everything needed to compile code against
// V8's internal headers without rebuilding V8, so it ships inside the gen-*
// release archives (build.yml packs <out>/gen after this runs). Node 20+, no
// dependencies.
//
// usage: node tools/gen-build-info.js <v8-dir> <out-dir>
//   e.g. node tools/gen-build-info.js v8 out.gn/linux.x64.release
//   (<out-dir> relative to <v8-dir>, as in build.yml)
//
// Writes:
//   info.json               V8 commit + version, platform, compiler version,
//                           patches applied, and any step that failed
//   args.gn                 the args file as given
//   args.json               every resolved GN arg (gn args --list --json)
//   compile_commands.json   the exact compile command of every C/C++ file in
//                           the default toolchain (ninja -t compdb cxx cc):
//                           defines, include dirs and flags, per file
//   v8_base_without_compiler.json
//                           that target's defines, include_dirs, cflags,
//                           cflags_cc (gn desc), the flags V8's own object
//                           code was built with
//   root/                   every header the build used that is outside
//                           src/, include/ and the out dir (abseil, etc.),
//                           at its path relative to the V8 root, from
//                           ninja's dependency log (ninja -t deps)
//   README.md               how to use it
//
// Never fails the build: each step records its error in info.json and the
// script exits 0, so a release is never blocked by this.

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WIN = process.platform === 'win32'

const [v8Arg, outArg] = process.argv.slice(2)
if (!v8Arg || !outArg) {
  console.error('usage: node tools/gen-build-info.js <v8-dir> <out-dir>')
  process.exit(1)
}
const V8_DIR = resolve(v8Arg)
const OUT_DIR = resolve(V8_DIR, outArg)
const INFO_DIR = join(OUT_DIR, 'gen', 'build-info')
mkdirSync(INFO_DIR, { recursive: true })

const errors = []

function step (name, fn) {
  try {
    console.log(`build-info: ${name}`)
    return fn()
  } catch (err) {
    console.error(`build-info: ${name} failed: ${err.message}`)
    errors.push({ step: name, error: err.message })
    return undefined
  }
}

// depot_tools' gn/ninja are .bat wrappers on Windows: they need a shell there
function capture (cmd, args, cwd = V8_DIR) {
  const r = spawnSync(cmd, args, {
    cwd, encoding: 'utf8', shell: WIN, maxBuffer: 1024 * 1024 * 1024
  })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: exit ${r.status}: ${(r.stderr || '').slice(0, 2000)}`)
  return r.stdout
}

function write (name, text) {
  writeFileSync(join(INFO_DIR, name), text)
}

const outRel = relative(V8_DIR, OUT_DIR)

step('args.gn', () => copyFileSync(join(OUT_DIR, 'args.gn'), join(INFO_DIR, 'args.gn')))

step('args.json', () => {
  const json = JSON.parse(capture('gn', ['args', outRel, '--list', '--json']))
  write('args.json', JSON.stringify(json, null, 2) + '\n')
})

let compdb
step('compile_commands.json', () => {
  const text = capture('ninja', ['-C', outRel, '-t', 'compdb', 'cxx', 'cc'])
  compdb = JSON.parse(text)
  write('compile_commands.json', text)
})

step('v8_base_without_compiler.json', () => {
  const target = {}
  for (const what of ['defines', 'include_dirs', 'cflags', 'cflags_cc']) {
    const desc = JSON.parse(capture('gn', ['desc', outRel, '//:v8_base_without_compiler', what, '--format=json']))
    const entry = Object.values(desc)[0] || {}
    target[what] = entry[what] || []
  }
  write('v8_base_without_compiler.json', JSON.stringify(target, null, 2) + '\n')
})

// headers outside src/, include/ and the out dir, from ninja's deps log.
// `ninja -t deps` prints each output, then its dependencies indented by four
// spaces, paths relative to the out dir (or absolute for system headers).
let headerCount = 0
step('root/ (third-party headers)', () => {
  const text = capture('ninja', ['-C', outRel, '-t', 'deps'])
  const seen = new Set()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('    ')) continue
    const p = line.trim()
    if (!p || /\.(cc|cpp|c|S|asm)$/.test(p)) continue
    const abs = isAbsolute(p) ? p : resolve(OUT_DIR, p)
    const rel = relative(V8_DIR, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) continue // system headers
    const top = rel.split(sep)[0]
    if (top === 'src' || top === 'include') continue // src.tar.gz, include.tar.gz
    if (abs.startsWith(OUT_DIR + sep)) continue // gen/ is already packed
    seen.add(rel)
  }
  for (const rel of seen) {
    const from = join(V8_DIR, rel)
    if (!existsSync(from)) continue
    const to = join(INFO_DIR, 'root', rel)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    headerCount++
  }
})

const info = {
  v8_commit: step('v8 commit', () => capture('git', ['rev-parse', 'HEAD']).trim()),
  v8_version: step('v8 version', () => {
    const h = readFileSync(join(V8_DIR, 'include', 'v8-version.h'), 'utf8')
    const n = k => (h.match(new RegExp(`#define V8_${k} (\\d+)`)) || [])[1]
    return `${n('MAJOR_VERSION')}.${n('MINOR_VERSION')}.${n('BUILD_NUMBER')}.${n('PATCH_LEVEL')}`
  }),
  out_dir: outRel.split(sep).join('/'),
  platform: `${process.platform}-${process.arch}`,
  patches: step('patches', () => readdirSync(join(REPO_ROOT, 'patches')).filter(f => f.endsWith('.patch')).sort()),
  compiler: step('compiler version', () => {
    if (!compdb || !compdb.length) throw new Error('no compile commands')
    const entry = compdb[0]
    const command = entry.command || (entry.arguments || []).join(' ')
    // first word, or a quoted path
    const m = command.match(/^\s*(?:"([^"]+)"|(\S+))/)
    const exe = m[1] || m[2]
    const path = isAbsolute(exe) ? exe : resolve(entry.directory, exe)
    return { path: relative(V8_DIR, path).split(sep).join('/'), version: capture(path, ['--version'], entry.directory).split(/\r?\n/)[0] }
  }),
  third_party_headers: headerCount,
  generated: new Date().toISOString(),
  errors
}
write('info.json', JSON.stringify(info, null, 2) + '\n')

write('README.md', `# build-info

How this V8 (${info.v8_version}, commit ${info.v8_commit}) was built, so code can be compiled against
V8's **internal** headers and linked against the released \`libv8_monolith\` without rebuilding V8.
Written by \`tools/gen-build-info.js\` in https://github.com/just-js/v8.

## Layout

Recreate the build's directory layout, then compile from the out dir with the commands unchanged:

    mkdir v8 && cd v8
    tar -xzf src.tar.gz            # src/
    tar -xzf include.tar.gz        # include/
    tar -xzf gen-<platform>.tar.gz # ${info.out_dir}/gen/ (this directory is gen/build-info/)
    cp -R ${info.out_dir}/gen/build-info/root/. .   # third_party/, buildtools/, ... headers
    cd ${info.out_dir}

\`compile_commands.json\` gives every V8 file's exact compile command (\`directory\` is the CI path: use the
out dir above). For a new file, copy the command of a file from the same target, for example
\`../../src/objects/js-array-buffer.cc\` (target \`v8_base_without_compiler\`), and change the source and
output. Defines must match exactly: a different define changes object layouts without a compile error.
\`v8_base_without_compiler.json\` has that target's defines, include dirs and flags on their own.

Compiler: ${info.compiler ? `\`${info.compiler.version}\`` : 'unknown'}. Using a different clang
version is usually fine for headers-only use, but check \`info.json\`.

## What this does and doesn't allow

- **Allows:** C++ that uses \`v8::internal\` classes and functions (for example a binding that
  calls \`JSArrayBuffer\`/\`Factory\` code), linked against \`libv8_monolith\`, which exports those symbols.
- **Doesn't allow:** adding or changing Torque/CSA builtins. Builtins are compiled to machine code by
  \`mksnapshot\` during the V8 build and embedded in the library; changing one needs a V8 build.
- Internals are not API: code using them is tied to this exact V8 commit and build config.
`)

console.log(`build-info: wrote ${INFO_DIR} (${headerCount} third-party headers, ${errors.length} errors)`)
