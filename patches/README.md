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
- **[`14.8-wasm-shuffle-reducer-value-or-braces.patch`](14.8-wasm-shuffle-reducer-value-or-braces.patch)**
  — `src/compiler/turboshaft/wasm-shuffle-reducer.cc:576` at
  `branch-heads/14.8` calls `max.value_or({})` on a
  `std::optional<uint8_t>` — real, confirmed build failure on
  `mac (arm64)`'s real CI toolchain (Xcode 16.4 / macOS 15.5 SDK's
  libc++, so not specific to this project's own clang+libc++ setup
  either): `error: no matching member function for call to 'value_or'`,
  because `value_or(_Up&& __v)`'s forwarding-reference template
  parameter `_Up` can't be deduced from a bare `{}`. Fetched the real
  `branch-heads/14.8` source directly and confirmed the exact line.
  Fix: `max.value_or({})` → `max.value_or(0)` — an `int` literal
  deduces `_Up = int` fine, and `value_or`'s declared return type
  (`value_type`, i.e. `uint8_t`) converts it implicitly, same semantics
  as before (default to zero when `max` is empty). Verified the
  `std::optional<uint8_t>`/`std::max` call shape compiles in isolation
  before trusting it; not yet confirmed against a real CI run.
- **[`14.8-template-h-cast-function-type-mismatch.patch`](14.8-template-h-cast-function-type-mismatch.patch)**
  — `include/v8-template.h` at `branch-heads/14.8` has a real, live V1→V2
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
