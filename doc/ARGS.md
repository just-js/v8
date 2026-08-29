# GN build args — what every `args.*.gn` sets, and why

A field guide to every GN arg set across this repo's 6 platform build
files (`args.linux.x64.gn`, `args.linux.arm64.gn`, `args.mac.x64.gn`,
`args.mac.arm64.gn`, `args.win.x64.gn`, `args.win.arm64.gn`). Very brief
by design — for the flags that have a real, deeper investigation behind
them (pointer compression, cppgc's caged heap, the minimal-size
variant, `symbol_level`/`strip_debug_info`), this doc gives the short
version and links out to [`V8-BUILD-OPTS.md`](V8-BUILD-OPTS.md) in this
same directory rather than duplicating it.

Two families of flag here: plain Chromium/GN build-system args (no
prefix — `is_debug`, `use_rtti`, etc., defined in `build/` — a
`gclient`-fetched dependency, not part of this repo's own source) and
`v8_*`/`cppgc_*` args (V8's own, defined in V8's `BUILD.gn`/`gni/v8.gni`).
Descriptions are anchored to the V8 release currently pinned by this
repo (see the repo-root [`README.md`](../README.md) for the exact
version) — a flag's default or even its existence can drift across V8
versions, so treat line-number citations here as approximate for any
other version.

## 1. Set identically on all 6 platforms

| Flag | Value | What it does | Alternative |
|---|---|---|---|
| `is_clang` | `true` | Compile with clang, not gcc/MSVC. | `false` — gcc on Linux; MSVC is a documented unsupported combo for V8+libc++ (see `use_custom_libcxx` below). |
| `is_debug` | `false` | Release vs. debug build (optimizations on, assertions off). | `true` — much slower/larger, not what a shipped `libv8_monolith` wants. |
| `is_component_build` | `false` | One static/monolithic output vs. every target as its own shared library. | `true` — only useful for Chromium-style incremental-link dev iteration; irrelevant once `v8_monolithic=true` is the actual goal. |
| `symbol_level` | `0` | How many debug symbols to embed (`0` none, `1` backtrace-only, `2` full). | `1`/`2`. **Real finding:** redundant with GN's own computed default on Linux, but *load-bearing* on macOS/Windows — their real default is `2` (full symbols) regardless of release/debug. Full derivation: [V8-BUILD-OPTS.md](V8-BUILD-OPTS.md). |
| `strip_debug_info` | `true` | Per its own GN comment: **Android-only** — strips `lib.unstripped/*.so` after link while keeping backtraces symbolizable via `symbol_level>0`. | `false`. **Real finding:** does nothing on any of these 6 platforms (none are Android) — no consumer of the flag found outside Android APK packaging. Harmless, likely inherited unexamined from an early build-feasibility reference. Same writeup as above. |
| `treat_warnings_as_errors` | `false` | Abort compilation on any compiler warning. | `true` (Chromium's real default) — risky here since each platform compiles against its own CI runner's toolchain version, not one pinned/vendored copy. |
| `use_sysroot` | `false` | Use Chromium's bundled/pinned sysroot instead of the host's own libc/headers. | `true` (real default) — would need Chromium's sysroot-fetch machinery; instead each runner compiles against its own real system libc/libstdc++, which is *why* [`../patches/`](../patches/) exists (real source bugs some V8 branch-heads have that Google's own CI, using the pinned sysroot, never hits). |
| `dcheck_always_on` | `false` | Force `DCHECK()`-style asserts on even in a release build. | `true` — extra runtime safety checks, slower. Already GN's own default; this line is documentation only. |
| `enable_rust` | `false` | Enable the Chromium build's Rust toolchain integration. | `true`, needs a Rust toolchain present; not applicable to V8 itself. Already GN's own default here too. |
| `clang_use_chrome_plugins` | `false` | Chromium's custom clang static-analysis plugins (coding-style/lifetime checks). | `true` — only usable with Chromium's own clang build, not a standalone toolchain. |
| `v8_deprecation_warnings` | `false` | Compiler warnings on `V8_DEPRECATED`-annotated embedder APIs. | `true` (real default) — useful when actively chasing deprecations ahead of a version bump, just noise for a release build. |
| `v8_imminent_deprecation_warnings` | `false` | Same, for `V8_DEPRECATE_SOON`. | `true` (real default). |
| `v8_enable_i18n_support` | `false` | ECMAScript `Intl.*` API. | `true` (real default) — pulls in a real ICU dependency; bigger binary. |
| `v8_enable_pointer_compression` | `true` | Compress the JS heap's tagged pointers to 32-bit offsets into a 4GB cage. | `false` — real, direct memory-footprint win when on; flips several derived defaults (`v8_enable_external_code_space`, `v8_enable_static_roots`, `v8_enable_short_builtin_calls`). Full cascade: [V8-BUILD-OPTS.md](V8-BUILD-OPTS.md). |
| `v8_enable_sandbox` | `false` | V8's heap "sandbox" — confines all heap-object pointers to a smaller address range so a JS/Wasm memory-corruption bug can't be turned into an arbitrary read/write of host process memory. | `true` — real security hardening, aimed at the untrusted-JS-in-browser threat model. Worth turning on if your embedding runs untrusted script; off here since this build targets a trusted-script embedding use case, where the extra indirection/overhead buys nothing. |
| `v8_enable_temporal_support` | `false` | The `Temporal` date/time API. | `true` — off by default anywhere not building for Node; pulls in `temporal_rs`. |
| `v8_enable_test_features` | `false` | Various V8-internal testing-only features/flags. | `true` — only relevant to V8's own test suite. |
| `v8_monolithic` | `true` | Build one big static `libv8_monolith` for embedders, instead of V8's normal many-small-libraries layout. | `false` (real default) — this is the entire reason this repo exists: one linkable archive for embedders, rather than V8's normal Chromium-oriented many-small-libraries layout. |
| `v8_use_external_startup_data` | `false` | Keep builtins/startup snapshot embedded in the binary vs. a separate blob file loaded at runtime. | `true` — an extra file to ship/load, no benefit for a static-lib embedder. Confirmed correct already: [V8-BUILD-OPTS.md](V8-BUILD-OPTS.md). |
| `v8_enable_backtrace` | `false` | V8's own compiled-in crash-backtrace support (distinct from `symbol_level`/`strip_debug_info` above — this is V8-internal, not toolchain-level). | `true` — extra code/size; worth turning on if your embedder wants V8-native crash backtraces rather than relying on the OS/toolchain's own symbolication. |
| `v8_enable_gdbjit` | `false` | Emit a GDB JIT interface so `gdb`/`perf` can symbolicate V8's JIT-generated code. | `true` — already GN's own default; this line is documentation only. |
| `cppgc_enable_caged_heap` | `false` | cppgc's (C++-GC'd heap, e.g. for Blink DOM wrappers) own separate 16GB `PROT_NONE` virtual reservation. | `true` (real default). Off here because this build has no embedder-side `CppHeap` usage today — confirmed pure unused overhead in that case. **If your embedder constructs a `CppHeap`, re-enable this.** Full reasoning: [V8-BUILD-OPTS.md](V8-BUILD-OPTS.md). |
| `cppgc_enable_pointer_compression` | `false` | Pointer compression for the above (moot with it disabled). | `true` — only meaningful if the caged heap above is re-enabled. |
| `v8_enable_partition_alloc` | `false` | Use Chromium's PartitionAlloc as `d8`'s allocator, to mimic in-browser allocator behavior for benchmarking/testing. | `true` (real default once pointer compression is on) — pulls in glibc-only symbols (real musl link failure on Linux) and conflicts with the Xcode SDK's `operator new`/`delete` visibility declarations (real CI failure on macOS); pinned off everywhere for consistency, not only where strictly required. |

## 2. Platform/arch identity — set to the obvious value, not interesting

`target_os` (`linux`/`mac`/`win`), `target_cpu` (`x64`/`arm64`), and
`v8_target_cpu` (mirrors `target_cpu` on every one of these 6 files).
`v8_target_cpu` exists as its *own* flag separate from `target_cpu`
specifically to support cross-compiling V8's JIT for an architecture
different from the host's own (generate ARM code under an x86 host +
emulator) — not a mode this repo uses.

## 3. Differs by platform

| Flag | linux x64/arm64 | mac x64/arm64 | win x64/arm64 | What it does / why it differs |
|---|---|---|---|---|
| `use_custom_libcxx` | `false` | `false` | `true` | Use Chromium's in-tree/vendored libc++ instead of the system C++ standard library. Linux/mac link against the system libstdc++/libc++; Windows is forced `true` because MSVC's own STL is a documented unsupported/broken combo with clang-cl for building V8 (confirmed: a real `v8-users` thread hit the identical failure, and a V8 team reply says MSVC support "will soon be deprecated altogether" — see the repo-root [`README.md`](../README.md)). |
| `use_rtti` | `false` | `false` | `true` | Emit C++ RTTI (`dynamic_cast`/`typeid`) info. Off by default to save size; forced on for Windows as a paired requirement of `use_custom_libcxx=true` there. |
| `v8_enable_builtins_optimization` | `true` | *(unset)* | `true` | Bakes in a profile to PGO-optimize V8's builtins. Real default is `false`; per [V8-BUILD-OPTS.md](V8-BUILD-OPTS.md) this is very likely inert either way (needs an actual profile-generation build step this repo's workflow doesn't run) — mac's omission vs. linux/win's explicit `true` is inconsistent, but probably harmless for the same reason. |
| `v8_enable_snapshot_compression` | `false` | *(unset)* | `false` | Gzip-compress the startup snapshot blob — smaller binary, slower deserialize at every isolate startup. Real default is already `false` regardless of platform, so the explicit `false` on linux/win is redundant, and mac's omission is harmless for the same reason. |
| `is_cfi` | *(unset)* | `false` | *(unset)* | Control Flow Integrity instrumentation (protects virtual calls/casts). Off by default anywhere; only set explicitly on mac. **Open question, not resolved here:** unclear from these files alone whether mac-only is deliberate or incidental — flagging rather than assuming. |
| `is_asan` | *(unset)* | `false` | *(unset)* | AddressSanitizer instrumentation. Same mac-only-and-unexplained situation as `is_cfi` above. |

## 4. Linux/x64-only: the minimal-size build variant

Set only in `args.linux.x64.gn` — not (yet) mirrored to the other 5
platforms. Full reasoning, the real archive-size evidence per component,
and the `assert()`-enforced Maglev-requires-Turbofan constraint that
shaped the final choice: [V8-BUILD-OPTS.md](V8-BUILD-OPTS.md).

| Flag | Value | What it does | Alternative |
|---|---|---|---|
| `v8_enable_webassembly` | `false` | WebAssembly compiler + runtime + JS API. | `true` (real default) — real archive cost: 9.26MB/57 files. |
| `v8_enable_turbofan` | `false` | V8's top-tier optimizing JIT. | `true` (real default) — 8.44MB/26 files; a real `BUILD.gn` `assert()` means Maglev can't exist without it. |
| `v8_enable_maglev` | `false` | V8's mid-tier JIT, between Sparkplug and Turbofan. | `true` — 10.16MB/27 files, but requires Turbofan too (see above), so "Maglev only" isn't actually an option. |
| `v8_enable_sparkplug` | `true` | V8's fast, non-optimizing baseline JIT — smallest tier (0.27MB/3 files) and the only one with no coupling to the others, so the only one kept on. | `false` → fully jitless. |
| `use_thin_lto` | `false` | Cross-translation-unit link-time optimization via LLVM ThinLTO. | `true` — tried; hit a real cross-LLVM-version bitcode incompatibility (`"Not an int attribute"`) when linked against by a different LLVM version downstream, not yet revisited. |
| `v8_advanced_bigint_algorithms` | `false` | Faster BigInt algorithms, at a real 10-30KB binary-size cost. | `true` (real default off-Android) — dropped as part of the same minimal-size push. |

## External links

- [v8.dev/docs/build-gn](https://v8.dev/docs/build-gn) — V8's own GN build doc.
- [v8.dev/docs/build](https://v8.dev/docs/build) — general V8 build overview.
- [GN reference](https://gn.googlesource.com/gn/+/main/docs/reference.md) — the GN language/tool itself, not V8-specific.
- [v8.dev/blog/sandbox](https://v8.dev/blog/sandbox) — the V8 heap sandbox (`v8_enable_sandbox`), why it exists and its threat model.
- [`chromium/chromium` GitHub mirror: `build/config/compiler/compiler.gni`](https://github.com/chromium/chromium/blob/main/build/config/compiler/compiler.gni) — real source for `symbol_level`, `strip_debug_info`, `treat_warnings_as_errors`, `use_thin_lto`.
- [`chromium/chromium` GitHub mirror: `build/config/c++/c++.gni`](https://github.com/chromium/chromium/blob/main/build/config/c%2B%2B/c%2B%2B.gni) — `use_custom_libcxx`.
- [`chromium/chromium` GitHub mirror: `build/config/sanitizers/sanitizers.gni`](https://github.com/chromium/chromium/blob/main/build/config/sanitizers/sanitizers.gni) — `is_asan`, `is_cfi`.
- [`v8/v8` GitHub: top-level `BUILD.gn`](https://github.com/v8/v8/blob/main/BUILD.gn) — most `v8_*` args not in `gni/v8.gni` (`v8_enable_sandbox`, `v8_monolithic`, deprecation-warning flags, `v8_enable_partition_alloc`, `v8_enable_builtins_optimization`, `v8_enable_snapshot_compression`, `v8_enable_test_features`, `cppgc_enable_caged_heap`).
- [`v8/v8` GitHub: `gni/v8.gni`](https://github.com/v8/v8/blob/main/gni/v8.gni) — `v8_enable_i18n_support`, `v8_enable_temporal_support`, `v8_use_external_startup_data`, `v8_enable_backtrace`, `v8_advanced_bigint_algorithms`, `v8_enable_pointer_compression`, `v8_target_cpu`.

See also [`V8-BUILD-OPTS.md`](V8-BUILD-OPTS.md) in this directory for the
deeper performance/startup-memory tradeoffs behind a subset of the flags
above, and the real measured results of the minimal-size variant.
