# `patches/`

Small, real patches against V8's own source, applied automatically to
every platform build job right after the checkout is cached (`.github/
workflows/build.yml`'s "apply v8 patches" step, one per job) and before
anything compiles. Standard unified diffs, `-p1` layout (`a/`/`b/`
prefixes, matching `git diff`'s own default) — applied with `git apply`,
which fails the whole step loudly if a patch doesn't apply cleanly
(upstream source shape changed, wrong V8 version, etc.) rather than
silently skipping it.

**To add a patch:** drop a `.patch` file here. Every file matching
`patches/*.patch` gets applied, every job, every run — there's no
per-platform or per-version selection mechanism (not needed yet; add one
if a patch ever needs to apply to only some jobs).

**To remove/disable a patch:** delete the file, or rename it out of the
`*.patch` glob (e.g. append `.obsolete-at-<version>` — real precedent
below, `14.7-bigint-missing-memory-include.patch.obsolete-at-14.9`) if
you want to keep the file and its history around without it being
applied. Simplest possible revert: `git rm patches/<name>.patch`.

**Generating a new patch**, from a real before/after: `diff -u
<upstream-file> <fixed-file> | sed 's|^--- <upstream-file>|--- a/<path/in/v8/tree>|; s|^+++ <fixed-file>|+++ b/<path/in/v8/tree>|'`
— or, with a real local `v8/` checkout already patched by hand, just
`git -C v8 diff -- <path>` and copy the output here directly (already in
the right `a/`/`b/` format). Test it actually applies before committing:
`git -C v8 apply --check patches/<name>.patch`.

## Current patches

- **[`14.7-bigint-missing-memory-include.patch.obsolete-at-14.9`](14.7-bigint-missing-memory-include.patch.obsolete-at-14.9)**
  — **obsolete, renamed out of the `*.patch` glob so it's no longer
  applied, kept for reference/history rather than deleted.**
  `src/bigint/bigint.h` at `branch-heads/14.7` was missing
  `#include <memory>` (uses `std::unique_ptr`/`std::make_unique_for_overwrite`
  without it) — real, confirmed build failure
  (`error: no template named 'unique_ptr' in namespace 'std'`), not
  guessed: diffed directly against V8 mainline, where the include exists
  (landed sometime after the 14.7 branch cut, not yet backported to that
  branch at the time). See `V8.md`'s 14.7 notes for the full story.
  Confirmed still needed at 14.8 (applied cleanly there). **The
  parking-lot note written for this patch called it exactly**: bumping
  to 14.9 (2026-08-22) broke it — real CI failure, all 5 platforms,
  `error: patch failed: src/bigint/bigint.h:10` / `patch does not
  apply` — and fetching `branch-heads/14.9`'s real `bigint.h` directly
  confirmed why: upstream added `#include <memory>` itself somewhere
  between 14.7 and 14.9, so the fix this patch was applying now already
  exists in V8's own source. Not a broken patch, a superseded one.
  Renamed rather than deleted so the history/reasoning stays discoverable
  if a much later V8 version ever regresses the same include again.
- **[`14.8-object-h-missing-nullptr-t.patch`](14.8-object-h-missing-nullptr-t.patch)**
  — `include/v8-object.h` at `branch-heads/14.8` uses a bare `nullptr_t`
  (`AccessorNameGetterCallback getter, nullptr_t setter = nullptr` at
  line 408) with no `#include <cstddef>` anywhere in its own include
  chain — real, confirmed build failure on this project's clang+libc++
  toolchain (`error: unknown type name 'nullptr_t'; did you mean
  'std::nullptr_t'?`), not guessed: fetched the real
  `branch-heads/14.8` header directly and confirmed the missing include.
  `include/v8-template.h` hits the exact same error at ~15 more call
  sites — but it already has `#include <cstddef>` itself and still
  fails, because `<cstddef>` only guarantees `std::nullptr_t`, not an
  unqualified `::nullptr_t` in the global/`v8` namespace (some
  toolchains inject that as an extension, this one doesn't). Since
  `v8-template.h` includes `v8-object.h` first, fixing it there once
  covers both files rather than patching every call site individually:
  adds `#include <cstddef>` plus `using std::nullptr_t;` inside
  `namespace v8 { ... }`, right after the opening brace. Verified the
  fix compiles in isolation (a standalone `using std::nullptr_t;`
  translation unit) before trusting it; not yet confirmed against a
  real CI run.
- **[`14.8-wasm-shuffle-reducer-value-or-braces.patch.obsolete-at-14.9`](14.8-wasm-shuffle-reducer-value-or-braces.patch.obsolete-at-14.9)**
  — **obsolete, renamed out of the `*.patch` glob, kept for reference.**
  `src/compiler/turboshaft/wasm-shuffle-reducer.cc:576` at
  `branch-heads/14.8` called `max.value_or({})` on a
  `std::optional<uint8_t>` — real, confirmed build failure on
  `mac (arm64)`'s real CI toolchain (Xcode 16.4 / macOS 15.5 SDK's
  libc++, so not specific to this project's own clang+libc++ setup
  either): `error: no matching member function for call to 'value_or'`,
  because `value_or(_Up&& __v)`'s forwarding-reference template
  parameter `_Up` can't be deduced from a bare `{}`. Fix:
  `max.value_or({})` → `max.value_or(0)`. **Confirmed still needed at
  14.8** (real CI run). Broke again at 14.9 (2026-08-22, `tools/check-patches.js`
  caught it locally before pushing — same run that found the bigint patch
  above also obsolete, and the template-h regeneration below) — checked
  the real `branch-heads/14.9` source directly: upstream independently
  fixed the exact same deduction problem, just spelled
  `max.value_or(uint8_t{0})` instead of our `max.value_or(0)`. Same
  outcome as the bigint patch: superseded, not broken, retired rather
  than regenerated.
- **[`14.8-template-h-cast-function-type-mismatch.patch`](14.8-template-h-cast-function-type-mismatch.patch)**
  — **regenerated for 14.9** (2026-08-22): `tools/check-patches.js`
  caught this one failing to apply too, in the same 14.9 check that found
  both obsolete patches above. Unlike those, this was a real context
  shift, not a fix that disappeared — confirmed via `git apply --check -C1`
  (reduced context) succeeding where the full-context check failed,
  a reliable signal for "same fix, context moved" vs. "fix no longer
  needed" (tested against all three real 14.9 failures this session,
  not assumed). Root cause: `branch-heads/14.9` inserted a new
  `V8_DEPRECATE_SOON(...)` annotation directly above each of the 4 call
  sites this patch touches, shifting their line numbers without changing
  the underlying cast-mismatch bug at all. Regenerated by applying the
  old patch with reduced context against fresh 14.9 source to derive the
  fixed file, then diffing that against pristine 14.9 to produce a new,
  full-context-clean patch — verified applying cleanly against a
  completely fresh `branch-heads/14.9` checkout before replacing the old
  file. Original 14.8 story below still describes the underlying bug and
  fix correctly, only the line numbers changed.
  `include/v8-template.h` at `branch-heads/14.8` has a real, live V1→V2
  callback-signature migration in progress (`TODO(crbug.com/348660658):
  cleanup once migration ... is done`). Its own compatibility shims
  (`NamedPropertyHandlerConfiguration`/`IndexedPropertyHandlerConfiguration`'s
  private `ConvertSetter`/`ConvertDefiner` helpers) convert between the
  old and new callback typedefs — which differ only in their
  `PropertyCallbackInfo<void>` vs `PropertyCallbackInfo<Boolean>`
  template argument — via a plain functional-style cast
  (`return NamedPropertySetterCallbackV2(value);`, 4 call sites: both
  `Named*` converters at lines 760/772, both mirrored `Indexed*`
  converters at lines 887/899). Real, confirmed build failure on
  `windows (x64)`'s real CI toolchain (`error: cast from
  'NamedPropertySetterCallback' ... to 'NamedPropertySetterCallbackV2'
  ... converts to incompatible function type
  [-Werror,-Wcast-function-type-mismatch]`) — this fires just from
  *including* `v8.h` (these are plain non-template static member
  functions, type-checked at class-definition time, not deferred to
  first use), so any embedder including V8's headers on a toolchain with
  this warning enabled hits it, not just `lo`. Confirmed empirically in
  this sandbox that neither a C-style/functional cast nor a *direct*
  `reinterpret_cast` between the two function-pointer types silences
  this specific warning — only routing through an intermediate `void*`
  does (`reinterpret_cast<NamedPropertySetterCallbackV2>(reinterpret_cast<void*>(value))`),
  the standard idiom for an intentional, ABI-safe function-pointer
  reinterpretation that this specific clang warning's heuristic doesn't
  otherwise recognize. Verified the isolated pattern compiles clean with
  `-Wcast-function-type-mismatch -Werror` before trusting it. Linux/Mac
  never reached this file in the same run (they died earlier on the two
  patches above) — worth watching whether they hit this same error too
  once those are pushed; not yet confirmed either way.
- **[`14.9-disable-safe-libcxx-windows-torque-offset-fix.patch`](14.9-disable-safe-libcxx-windows-torque-offset-fix.patch)**
  — **an untested hypothesis, not a confirmed fix yet** (2026-08-22).
  Targets the real, unresolved Windows Torque/`JSAtomicsMutex` bug
  documented in `PLAN.md` task 40: a `static_assert` in
  `gen/torque-generated/src/objects/js-atomics-synchronization-tq.cc`
  fails because Torque's own internally-computed field offset for
  `JSAtomicsMutex::owner_thread_id_` (40) doesn't match what the real
  compiler produces via `offsetof()` (36) — Windows-only, root-caused to
  upstream commit `756c6901c3` ("Port `AlwaysSharedSpaceJSObject`
  subtree to `HeapObjectLayout`"), no upstream fix on this branch yet.
  Real, confirmed structural finding this session: Windows is the *only*
  platform in this build matrix with `use_custom_libcxx=true` (Linux/Mac
  use their system STL entirely) — checked a real Linux job's actual
  compile flags directly, `_LIBCPP_HARDENING_MODE` doesn't appear at
  all, while Windows's real compile command shows
  `_LIBCPP_HARDENING_MODE_EXTENSIVE`. Traced that define's own logic to
  its exact source (`build/config/compiler/BUILD.gn`, the
  chromium/src/build repo V8's `DEPS` pins):
  `use_safe_libcxx = use_custom_libcxx && enable_safe_libcxx` controls
  it — `EXTENSIVE` if true, `NONE` if false. `enable_safe_libcxx` itself
  is set unconditionally to `true` in V8's own
  `build_overrides/build.gni:37` (a plain assignment, not a
  `declare_args()`, so `args.win.x64.gn` can't override it directly —
  hence a patch instead). This patch flips it to `false`. Safe on the
  other 3 platforms regardless of outcome: since they already have
  `use_custom_libcxx=false`, `use_safe_libcxx` is already `false` there
  regardless of `enable_safe_libcxx`'s value — this patch is a no-op
  everywhere except Windows. **Whether hardening mode actually affects
  `std::atomic<uint32_t>`'s/`<int32_t>`'s layout in V8's vendored libc++
  version is not confirmed** — most libc++ hardening modes affect
  containers/iterators, not atomics, so this is a real, testable, cheap
  hypothesis (one CI run, no local Windows toolchain available to verify
  ahead of time), not a reasoned-through certainty. If this doesn't fix
  the static assertion, the next step is reading Torque's own C++
  layout-computation source (`src/torque/`) directly rather than testing
  more hypotheses one CI run at a time.
