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

**To remove/disable a patch:** delete the file, or move it out of this
directory (e.g. to a sibling `patches-parked/` if you want to keep it
around without it being applied — no such directory exists yet, create
one if this comes up). Simplest possible revert: `git rm patches/<name>.patch`.

**Generating a new patch**, from a real before/after: `diff -u
<upstream-file> <fixed-file> | sed 's|^--- <upstream-file>|--- a/<path/in/v8/tree>|; s|^+++ <fixed-file>|+++ b/<path/in/v8/tree>|'`
— or, with a real local `v8/` checkout already patched by hand, just
`git -C v8 diff -- <path>` and copy the output here directly (already in
the right `a/`/`b/` format). Test it actually applies before committing:
`git -C v8 apply --check patches/<name>.patch`.

## Current patches

- **[`14.7-bigint-missing-memory-include.patch`](14.7-bigint-missing-memory-include.patch)**
  — `src/bigint/bigint.h` at `branch-heads/14.7` is missing
  `#include <memory>` (uses `std::unique_ptr`/`std::make_unique_for_overwrite`
  without it) — real, confirmed build failure
  (`error: no template named 'unique_ptr' in namespace 'std'`), not
  guessed: diffed directly against V8 mainline, where the include exists
  (landed sometime after the 14.7 branch cut, not yet backported to that
  branch). See `V8.md`'s 14.7 notes for the full story. Parking-lot note
  for whoever revisits this at 14.8+: if 14.8 already has the include
  upstream, this patch will fail to apply (the context won't match a
  file that already has the line) — that's the signal to delete it, not
  investigate further. **Confirmed still needed at 14.8** (applied
  cleanly in the real CI run that surfaced the patch below, meaning
  `branch-heads/14.8`'s `bigint.h` still lacks the include too) — left
  in place.
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
