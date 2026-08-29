# V8 build options — performance and startup memory

A deeper look at the reasoning behind the less-obvious `v8_*`/`cppgc_*`
GN args set in this repo's `args.*.gn` files, plus options that were
considered and deliberately *not* applied, and the real measured results
of an experimental minimal-size build variant (pushed as its own branch,
not merged to main — see below). Companion to
[`ARGS.md`](ARGS.md) in this directory, which has the full flag-by-flag
matrix across all 6 platforms — this doc goes deeper on the subset of
flags where the "why" doesn't fit in a table cell.

Anchored to the V8 release currently pinned by this repo (see the
repo-root [`README.md`](../README.md)) — exact line numbers cited below
will drift on a version bump; the mechanisms they describe are stable
across recent V8 releases but worth re-checking against source on a
major jump.

## Pointer compression (`v8_enable_pointer_compression=true`)

Compresses the main JS heap's tagged pointers/`Smi`s to 32-bit offsets
into a cage, roughly halving pointer-sized fields across every V8
`HeapObject` — a real, direct memory-footprint win (smaller objects,
more fit per cache line, smaller GC working set to mark/sweep).

**Cost**, from V8's own headers (`include/v8-internal.h`):

```cpp
constexpr size_t kPtrComprCageReservationSize = size_t{1} << 32;  // 4GB
```

This is a **separate** reservation from cppgc's own caged heap (below) —
expect a distinct ~4GB `PROT_NONE` VA region in `/proc/<pid>/maps`,
alongside (not instead of) whatever cppgc region exists. Virtual-only,
no RSS cost on its own — real risk only under a tight `ulimit -v`/cgroup
VA cap.

**Real GN-derived side effects, not separately configured** — checked
against `BUILD.gn`'s own derivation logic:

- **`v8_enable_external_code_space`** defaults to `true` once pointer
  compression is on (requires `v8_enable_pointer_compression &&
  v8_enable_pointer_compression_shared_cage`, the latter itself
  defaulting to mirror pointer compression, plus a supported arch). Puts
  `Code` objects in a separate address range outside the 4GB cage so
  their compressed pointers don't compete with heap objects for the same
  4GB.
- **`v8_enable_static_roots`** defaults to `true` (requires exactly
  `pointer_compression && external_code_space`) — lets the snapshot
  embed fixed root-object addresses directly instead of patching them in
  at deserialization time. A real startup-time win, essentially free
  once the two flags above are on.
- **`v8_enable_short_builtin_calls`** stays `true` on arm64 too once
  pointer compression is on (it silently turns itself back off on
  non-x64 archs when pointer compression is off, since without it
  embedded builtins can't be guaranteed close enough in memory for a
  short call instruction sequence). No change on x64 (already true
  regardless).

None of these three are set explicitly in `args.*.gn` today — they're
inherited GN defaults that follow from `v8_enable_pointer_compression`
alone. Worth pinning them explicitly for documentation clarity and to
insulate against a future V8 version silently changing one of these
default-derivation conditions — no behavior change either way, since
they're already the derived values.

**Recommendation: keep pointer compression on.** Real memory win on the
main heap, the VA cost is virtual-only, and it unlocks two more
genuinely free wins (static roots, short builtin calls) as a side
effect.

## cppgc's caged heap (`cppgc_enable_caged_heap=false`)

cppgc is V8's C++ garbage-collected heap (used by embedders that manage
C++ objects alongside JS objects, e.g. Blink's DOM wrappers via
`CppHeap`). Its caged heap is a **separate** reservation from pointer
compression's own cage above — different compile-time gates
(`CPPGC_CAGED_HEAP`/`CPPGC_POINTER_COMPRESSION` vs.
`v8_enable_pointer_compression`) — and defaults *on* for every 64-bit
arch regardless of the pointer-compression setting, reserving a real
16GB `PROT_NONE` virtual address region at `V8::Initialize()` time,
unconditionally.

This build has no embedder-side `CppHeap` usage, so that 16GB
reservation is pure unused overhead here — confirmed safe to disable
directly against `BUILD.gn`: no `assert()` blocks turning this off on
64-bit (the only assert guards the reverse, 32-bit), and
`cppgc_enable_pointer_compression` only turns on inside the
`if (cppgc_enable_caged_heap)` block, so it cleanly follows.
**If your embedder constructs a `CppHeap`, re-enable this** — disabling
it is only correct in the absence of that usage.

## Lite mode / jitless — the biggest lever, deliberately not taken for the default build

`--lite-mode`/`--jitless` are the biggest available runtime/build-time
lever for trading performance away for memory. Not set by default here,
but worth documenting since it's the most consequential option on the
table.

**`--lite-mode`/`--jitless` are real, non-readonly *runtime* flags**
(not gated behind `V8_LITE_MODE`/`V8_JITLESS` compile-time macros) — in
`src/flags/flag-definitions.h`:

```cpp
DEFINE_BOOL(lite_mode, V8_LITE_MODE_BOOL, "...")
DEFINE_IMPLICATION(lite_mode, jitless)
DEFINE_IMPLICATION(lite_mode, optimize_for_size)
```

So any embedder can flip this at runtime via `v8flags`/`--jitless` on
the command line, regardless of how the library was built — JIT
compilation genuinely never fires once set, a real behavioral effect,
not a placebo.

**What build-time `v8_enable_lite_mode=true` (→ `v8_jitless=true`) adds
on top**, confirmed by real `sources +=` gates in `BUILD.gn`:

```
if (v8_enable_sparkplug) { sources += [ src/baseline/*.h, ... ] }
if (v8_enable_maglev)    { sources += [ src/maglev/*.h, ... ] }
```

With `v8_jitless=true`, `v8_enable_sparkplug`/`maglev`/`turbofan` all
default to `false`, meaning those entire compiler backends **aren't
compiled into the binary at all** — smaller binary, no dead JIT-compiler
code in the text segment. The runtime-only `--jitless` flag gets you the
*behavioral* win (JIT never runs) without this; the build-time flag
additionally gets you the *binary-size* win (the JIT code literally
isn't there).

**Not applied to the default build**: this repo publishes a
general-purpose `libv8_monolith` for a range of embedders, not a build
tuned to one fixed, narrow workload — full jitless is a severe,
workload-dependent perf cliff (pure Ignition bytecode interpretation, no
tiering at all) that's a poor default for an unknown consumer. The
per-platform `args.*.gn` pattern already supports a dedicated variant
(see the experimental minimal-size build below, which took a narrower
cut instead — Sparkplug kept, only Maglev/TurboFan/WASM removed) rather
than changing the default build's tradeoffs for everyone.

## `single_generation`/`disable_write_barriers` — a real gotcha for anyone tempted to set these at runtime

Both `disable_write_barriers` and `single_generation` are declared
`DEFINE_BOOL_READONLY` in `src/flags/flag-definitions.h` — hardwired at
*compile* time to the `v8_disable_write_barriers`/
`v8_enable_single_generation` GN args, neither of which is set anywhere
in `args.*.gn` today (both default `false`).

**What actually happens if you try to set a readonly flag via
`SetFlagsFromString`** (`src/flags/flags.cc`): `CheckFlagChange`
explicitly special-cases `IsReadOnly()` — it either raises a `FlagError`
(if flag-contradiction checking is on) or just `return`s `false`
**before the value is ever changed**. Passing `--disable-write-barriers`/
`--single-generation` as a runtime flag string against this build is a
complete no-op, not a reduced effect.

**To make it real**, both need to go into `args.*.gn` together — GN's
own `assert(!v8_disable_write_barriers || v8_enable_single_generation,
...)` requires them paired:

```
v8_enable_single_generation=true
v8_disable_write_barriers=true
```

**Tradeoff**: eliminates the young generation entirely — every
allocation goes straight to old space, no cheap generational scavenge,
no write-barrier bookkeeping on every pointer store. A plausible win for
short-lived, small-heap CLI-style processes; a bad fit for any workload
producing lots of short-lived garbage, where it turns into more frequent
full-heap GCs. Not applied by default — only worth it paired with a
deliberate small-heap build variant, never as a runtime-only flag (see
the gotcha above).

## `v8_enable_private_mapping_fork_optimization` — considered, not yet applied

Not set anywhere in `args.*.gn` today (default `false`). Per `BUILD.gn`'s
own comment:

> This flag speeds up the performance of fork/execve on Linux systems
> for embedders which use it (like Node.js). It works by marking the
> pages that V8 allocates as `MADV_DONTFORK`. Without `MADV_DONTFORK`,
> the Linux kernel spends a long time manipulating page mappings on fork
> and exec which the child process doesn't generally need to access.

Relevant to any embedder on Linux that `fork()`s (e.g. to spawn
subprocesses) without the child immediately touching V8's heap/code
mappings — every such fork currently pays the full page-table
duplication cost across V8's entire address space, work the child
(about to `exec`) never needed. A candidate worth adding at least to the
Linux `args.*.gn` files if your embedder does this — the GN `defines +=`
this flag adds is unconditional, so it's harmless-but-inert to also set
on mac/win, where `fork()`-without-`exec` isn't the same story anyway.

## `v8_enable_builtins_optimization` — currently set, very likely inert

`args.*.gn` sets this `true` on linux/windows (unset, so `false`, on
mac — see [`ARGS.md`](ARGS.md) §3). Checked what it actually needs, end
to end:

- `BUILD.gn`'s derivation resolves `v8_builtins_profiling_log_file` to
  `tools/builtins-pgo/profiles/x64.profile` (or `x64-rl.profile`) when
  this flag is on — a **profile-guided builtins-reordering input file**.
- That directory in a real V8 checkout of this release contains only a
  `.gitkeep` — no `.profile` files are checked into the V8 repo itself.
- The hook that would populate it is gated on a `gclient` custom var
  (`checkout_v8_builtins_pgo_profiles`) that defaults `false` and has to
  be explicitly turned on.
- This repo's build workflow does a plain `fetch v8` + `gclient sync`
  with no custom vars set — that hook never fires.

**So `v8_enable_builtins_optimization=true` almost certainly does
nothing right now** on the platforms where it's set — the profile file
it wants isn't in the checkout, and V8's build tolerates the missing
profile silently (no PGO data, not a hard build error) rather than
failing.

**To make it real**: requires a workflow change (setting
`checkout_v8_builtins_pgo_profiles` via a `.gclient` custom var or
`gclient sync -c`), not just an `args.*.gn` edit — flagged as a real,
currently-unrealized option, not applied.

## Snapshot/startup-data choices

- **`v8_use_external_startup_data=false`** (embed snapshot + builtins
  data directly in the binary, no separate blob file read at startup).
  Correct for a single-static-binary distribution model — the embedded
  path is real and compiled: a real build produces `gen/snapshot.cc`/
  `gen/embedded.S`, the actual generated sources for this path.
- **`v8_enable_snapshot_compression=false`**. Compressing the snapshot
  blob shrinks on-disk/binary size at the cost of a zlib decompression
  pass on **every single isolate creation**. Right call for a
  process-per-invocation-style embedder (fresh process, fresh isolate,
  every run — not a long-lived server amortizing that cost); reconsider
  if your embedder keeps isolates alive across many operations, where
  the one-time decompression cost matters less.
- **`v8_enable_i18n_support=false`**. Drops the ICU dependency
  entirely — a large binary-size and startup-data win (ICU's data file
  is multi-megabyte) for an embedder that doesn't need
  `Intl`/locale-aware formatting. Flip this on if your embedder needs
  `Intl.*`.

## `symbol_level` / `strip_debug_info`

Covered in full in [`ARGS.md`](ARGS.md) (real `declare_args()` blocks
quoted, full derivation of GN's default). Short version: `symbol_level=0`
is set on all 6 platforms — redundant with GN's own computed default on
Linux, but *load-bearing* on macOS/Windows, whose real default is `2`
(full symbols) regardless of release/debug. `strip_debug_info=true` is
also set on all 6, but per its own GN comment is Android-only — it does
nothing on any platform this repo actually targets.

## The minimal-size build variant — experimental, not on main

**This is not part of the default build.** It lives on the
[`v8-minimal-linux-x64`](https://github.com/just-js/v8/tree/v8-minimal-linux-x64)
branch — pushed, CI-built, and real-world benchmarked (below), but not
merged to `main` — so none of the flags in this section are set in the
`args.*.gn` files this repo actually publishes releases from. Included
here because the results are real and worth having on record for anyone
considering the same tradeoff, not because it ships today.

The goal, on that branch: a genuinely smaller `libv8_monolith.a` for
anyone building a much smaller runtime, published the same way this
repo's CI already publishes the main release assets, if it's ever
merged. Scoped to linux/x64 first before deciding whether it's worth
mirroring to the other 5 platforms.

**What's cut, and why:**

- **`v8_enable_webassembly=false`** — WebAssembly's global bootstrap is
  gated behind `V8_ENABLE_WEBASSEMBLY` at compile time, so disabling it
  is a genuine, real removal (not just "unreferenced, linker already
  drops it" — most of V8's core JS-builtin surface is reachable
  transitively from `Isolate::New`'s own bootstrap regardless of what a
  given script uses, so link-time-only pruning has limited room outside
  cases like this one that are explicitly compile-time-gated). Real
  cost: this removes `WebAssembly.*` globally — confirm nothing in your
  embedder needs it before adopting this variant.
- **`v8_enable_turbofan=false` / `v8_enable_maglev=false`** — the two
  optimizing JIT tiers. A real, source-confirmed constraint shaped this:
  `BUILD.gn` has `assert(v8_enable_turbofan || !v8_enable_maglev,
  "Maglev is not available when Turbofan is disabled.")` — Maglev
  can't exist without Turbofan, so "Maglev-only" isn't actually an
  option; keeping Maglev means paying for Turbofan too (the two biggest
  tiers combined).
- **`v8_enable_sparkplug=true`** (kept) — V8's fast, non-optimizing
  baseline JIT. Gated purely on `!v8_jitless` in `gni/v8.gni`, with no
  coupling to the other tiers — the only one that can genuinely stand
  alone, and by far the smallest.
- **`v8_advanced_bigint_algorithms=false`** — real, quantified per V8's
  own comment: "about 10-30 KB binary size" for faster BigInt algorithms,
  on by default off-Android. Small, but free, so dropped too.
- **`use_thin_lto=false`** — tried `true` (ThinLTO), and it's **not
  currently usable across a toolchain boundary**: the resulting
  `v8_monolith.a` ships as real LTO bitcode rather than pre-resolved
  native code, and linking that against an embedder built with a
  *different* LLVM version fails hard:
  ```
  ld.lld: error: ...(default-foreground-task-runner.o):
  Not an int attribute (Producer: 'LLVM23.0.0git' Reader: 'LLVM 22.1.8')
  ```
  This is LLVM's bitcode reader rejecting a bitcode version it doesn't
  understand — the standard failure mode for cross-LLVM-version bitcode
  incompatibility (confirmed against independent prior art hitting the
  identical error shape and wording in other projects). `-flto` on the
  *consuming* build doesn't matter here — `ld.lld` auto-detects
  bitcode-format inputs by file magic and attempts its own LTO codegen
  regardless of whether the consumer's own compile step requested LTO.
  **Practical implication: `use_thin_lto=true` is only safe if the exact
  same LLVM version builds both V8 and whatever links against
  `v8_monolith.a` downstream** — a real, nontrivial cross-toolchain
  pinning requirement if you want to use it, not a minor detail.

**Real measured results**, comparing this variant's archive against the
full-featured build: the full archive is **103,622,002 bytes (~103.6MB,
1,326 object files)**; the minimal (WebAssembly + Turbofan + Maglev off,
Sparkplug kept, native code not LTO bitcode) is **35,490,564 bytes
(~35.5MB, 1,038 object files)** — confirmed genuine native ELF64 object
code, a real **~66% size reduction**. Object-count breakdown before the
cut, gathered directly from `ar tv` + filename-pattern matching on the
full archive: WASM 9.26MB/57 files, Maglev 10.16MB/27 files, a partial
(undercounted — many TurboFan files aren't cleanly name-matchable)
TurboFan count of 8.44MB/26 files, Sparkplug 0.27MB/3 files. After the
cut: WASM 0 objects, Maglev 1 object (essentially gone — one stub
remains), TurboFan-named objects absent entirely.

A Sparkplug-only build (Turbofan/Maglev/WASM all off, matching the
variant above) and a full-jitless build (everything off, via
`v8_enable_lite_mode=true`) came out **essentially the same final
size** (~36.0MB vs ~35.5MB) — Sparkplug's own footprint (0.27MB of the
original 91.4MB raw archive) is negligible next to what
WASM+Maglev+TurboFan removal already bought, so there's no real
size reason to prefer full-jitless over keeping Sparkplug.

**Real benchmark, comparing the three variants on a sustained,
repeated-iteration workload (a TypeScript-checker-shaped benchmark,
60s runs each):**

| Variant | mean | min | p50 | p90 | p99 |
|---|---|---|---|---|---|
| Full jitless (`v8_enable_lite_mode=true`) | 1020.8ms | 943.6ms | 1003.1ms | 1067.2ms | 1328.6ms |
| Sparkplug-only (this variant) | 549.6ms | 511.8ms | 543.7ms | 566.7ms | 733.3ms |
| Full (Ignition+Sparkplug+Maglev+TurboFan) | 159.9ms | 138.9ms | 151.5ms | 179.5ms | 259.8ms |

Sparkplug is a real, substantial win over full-jitless (**1.86x faster**
mean) — matches V8's own stated design goal for it (short-lived,
command-line-tool-shaped sessions). But for a *sustained* workload like
this one, it's not a substitute for an optimizing tier: full is **3.44x
faster than Sparkplug-only, 6.38x faster than full-jitless** — most of
the win on hot, repeated code genuinely belongs to TurboFan's tier-up,
not Sparkplug's one-shot baseline compile.

**Practical guidance**: for a general-purpose embedding running
sustained/hot workloads, the full build remains the right default — no
size-reduced variant beats keeping TurboFan for that shape of work. The
Sparkplug-only variant (this one) is the right choice specifically where
binary-footprint matters more than hot-code throughput, or where the
actual workload is short-lived/cold-start-dominated rather than a long,
repeated-iteration loop. Full-jitless is rarely the better choice over
Sparkplug-only once you've already paid the WASM+Maglev+TurboFan
size cost — it gives up real, cheap performance for no further size win.

## Startup memory — runtime flags worth knowing about

Checked against real V8 heap-sizing source (`src/heap/heap.cc`,
`src/flags/flag-definitions.h`), beyond what the build-time flags above
already cover.

**`--optimize-for-size`** doesn't just cap `max_semi_space_size` at
1MB (a `DEFINE_VALUE_IMPLICATION` in `flag-definitions.h`) — it also,
per `Heap::`'s own sizing code, *skips* the "start with at least 1MB
semi-space on machines with a lot of memory" bump that applies
otherwise, keeping the initial semi-space at V8's true floor
(`Heap::DefaultMinSemiSpaceSize()`, 512KB). Nothing more to gain on the
semi-space/new-generation side beyond this flag — it already reaches the
real minimum.

**`--initial-old-space-size=N` / `--initial-heap-size=N`** — both
genuinely runtime-settable, real code paths in `Heap::`'s sizing logic.
Left unset, both take V8's real default:
`Heap::DefaultInitialOldGenerationSize()` = `256 * MB *
HeapLimitMultiplier(physical_memory)`. `HeapLimitMultiplier` is **not
actually RAM-scaled despite the parameter name** — the real code is
`return kSystemPointerSize / 4;`, which on any x64 build is a fixed
`8/4 = 2`, giving a real, confirmed **512MB default initial
old-generation size regardless of actual host RAM**.
`--initial-old-space-size=1` (or similarly small) targets this directly
if your embedder wants a smaller starting heap — a real, substantial
lever most embedders leave untouched.

**One honest gap**: whether that 512MB default actually shows up as
real, touched RSS at startup, or is a lazily-committed reservation the
way the pointer-compression cage and cppgc's caged heap both are, isn't
verified here — worth checking directly (`grep VmRSS
/proc/<pid>/status` right after isolate creation, with and without
`--initial-old-space-size=1`) before assuming the full 512MB is a real
memory cost rather than a mostly-harmless address-space reservation.

Also present but not evaluated here: `initial_shared_heap_size` and
`preconfigured_old_space_size` (default 32MB, gated behind the
`--future` flag implication) — more relevant to multi-isolate setups
than a single-isolate-per-process usage pattern.

## Summary: options worth adopting if you build your own variant

```diff
 v8_enable_pointer_compression=true      # already applied — recommend keeping
+v8_enable_external_code_space=true      # already the derived default — pin explicitly
+v8_enable_static_roots=true             # already the derived default — pin explicitly
+v8_enable_short_builtin_calls=true      # already the derived default — pin explicitly
+v8_enable_private_mapping_fork_optimization=true   # real win for any embedder that fork()s
```

Only worth doing as a deliberate small-heap/no-write-barrier build
variant — never pair with a runtime-only `--disable-write-barriers`/
`--single-generation` flag, which would be a silent no-op without these:

```diff
+ v8_enable_single_generation=true
+ v8_disable_write_barriers=true
```

Only worth doing if the builtins-PGO win is actually wanted — needs a
build-workflow change (`gclient` var), not just an `args.*.gn` edit, to
stop being a no-op:

```diff
- v8_enable_builtins_optimization=true    # currently inert either way on the platforms that set it
```

Not recommended as the *default* build's setting (see the minimal-size
variant above for the better-scoped alternative):

```
v8_enable_lite_mode=true   # → v8_jitless=true; severe, workload-
                           # dependent perf cost for a binary-size win
                           # already better captured by the Sparkplug-
                           # only variant above
```

## Reference: which runtime `--v8-flags` are actually settable at all

Worth checking against `src/flags/flag-definitions.h` in the version
you're building before adding any of these to an embedder's runtime
flags string — some look like runtime knobs but are compile-time-fixed
and will silently do nothing:

| Flag | Runtime-settable? |
|---|---|
| `--lite-mode` / `--jitless` | **Yes** — non-readonly, real runtime behavior change. |
| `--single-threaded` | **Yes** — non-readonly, disables background/concurrent tasks. |
| `--optimize-for-size` | **Yes** — non-readonly, shrinks `max_semi_space_size` to 1MB. |
| `--memory-reducer` | Yes, but redundant — already the compiled-in default. |
| `--max-heap-size=N` | Yes — sets a real heap cap. |
| `--disable-write-barriers` / `--single-generation` | **No — silent no-op** unless the matching `v8_*` GN args were set at build time (see above), both are readonly flags. |
