# v8 monolithic library builds

this repo containes up-to-date builds of the google v8 monolithic libraries for the following platforms

contributions are welcome!

# current release

- [tag](https://github.com/just-js/v8/releases/tag/15.1)
- [v8 headers](https://github.com/just-js/v8/releases/download/15.1/include.tar.gz)
- [v8 source](https://github.com/just-js/v8/releases/download/15.1/src.tar.gz)

## linux x64 ✅

- [static libraries](https://github.com/just-js/v8/releases/download/15.1/libv8_monolith-linux-x64.a.gz)
- [build args](args.linux.x64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/15.1/gen-linux-x64.tar.gz)

## linux arm64 ✅

- [static libraries](https://github.com/just-js/v8/releases/download/15.1/libv8_monolith-linux-arm64.a.gz)
- [build args](args.linux.arm64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/15.1/gen-linux-arm64.tar.gz)

## macos x64 ✅

- [static libraries](https://github.com/just-js/v8/releases/download/15.1/libv8_monolith-mac-x64.a.gz)
- [build args](args.mac.x64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/15.1/gen-mac-x64.tar.gz)

## macos arm64 ✅

- [static libraries](https://github.com/just-js/v8/releases/download/15.1/libv8_monolith-mac-arm64.a.gz)
- [build args](args.mac.arm64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/15.1/gen-mac-arm64.tar.gz)

## windows x64 ✅

- [static library](https://github.com/just-js/v8/releases/download/15.1/libv8_monolith-win-x64.zip)
- [build args](args.win.x64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/15.1/gen-win-x64.zip)
- [libc++ headers](https://github.com/just-js/v8/releases/download/15.1/libcxx-headers-win-x64.zip)

## patches

Some V8 branch-heads ship with real, confirmed source bugs (missing
`#include`s, a `std::optional::value_or({})` template-deduction failure,
etc.) that don't reproduce in Google's own CI - most likely because this
build intentionally sets `use_custom_libcxx=false`/`use_sysroot=false`
(see each platform's `args.*.gn` above), compiling against each runner's
own system C++ standard library instead of Chromium's pinned/vendored
one. Small unified-diff patches for known-bad branch-heads live in
[`patches/`](patches/) and get applied automatically to every platform
job right before compiling - see [`patches/README.md`](patches/README.md)
for the mechanism and the current list of what's patched and why.

## local dev tools

Node ESM scripts (no deps) under [`tools/`](tools/) for checking things
locally instead of waiting on/consuming a GitHub Actions run:

- **[`tools/check-patches.js`](tools/check-patches.js)** - before bumping
  `V8_VERSION`, checks whether every patch in [`patches/`](patches/)
  still applies cleanly against a target version's real source (fetched
  straight from `raw.githubusercontent.com/v8/v8`, no full V8 clone) -
  catches a patch going obsolete/context-drifted in seconds instead of a
  full CI round-trip.
  ```
  node tools/check-patches.js 15.1
  ```
- **[`tools/build-mac-local.js`](tools/build-mac-local.js)** - macOS
  only. Mirrors `build.yml`'s `build-mac` job step-for-step (depot_tools
  clone/reset, `fetch v8` + checkout `branch-heads/<version>`, apply
  `patches/*.patch`, `gn gen` + `ninja v8_monolith`/`d8`) on real Mac
  hardware. Also builds `d8` and regenerates a repo-root
  `compile_commands.json` (editor tooling) each run. Doesn't force a
  `DEVELOPER_DIR` by default - unlike CI's GitHub-runner-image-specific
  pin, this just uses whatever Xcode `xcode-select` already resolves;
  set `DEVELOPER_DIR` yourself first to pin a specific one. Re-running is
  safe (resets, not re-clones, depot_tools; force-checks-out `v8` back to
  a clean `branch-heads/<version>` before reapplying patches).
  ```
  node tools/build-mac-local.js arm64        # or x64, defaults to 15.1
  node tools/build-mac-local.js arm64 15.1
  ```
- **[`tools/build-verify.js`](tools/build-verify.js)** - macOS only.
  Downloads a real `just-js/lo` checkout (default `main`, or pass a
  branch/tag/commit sha) and builds it against whatever
  `build-mac-local.js` just produced, running the same checks
  `build.yml`'s `build-mac` job's sanity-test steps do (stage the v8
  headers/static lib into `lo`'s expected layout, `make lo`, run a real
  smoke test checking both exit code and output) - so a local V8 change
  can be verified against a real `lo` build end-to-end. `lo-verify/` is a
  disposable scratch checkout this script owns (a fresh tarball
  extraction every run); safe to delete.
  ```
  node tools/build-verify.js arm64              # lo@main
  node tools/build-verify.js arm64 my-branch
  node tools/build-verify.js arm64 3f9a1c2      # a commit sha
  node tools/build-verify.js arm64 main --check # + `make check`/`check-build`
  ```
  `--check` additionally runs `lo`'s own `make check` (runtime sanity
  tests) and `make check-build` (`test/build.js`) - broader than the
  single eval smoke test, off by default since they're slower.
  Linux/Windows equivalents aren't built yet - `build.yml`'s own linux
  job builds `lo` via Docker (`docker/Dockerfile.ubuntu`/`.alpine`) and
  its windows job via `build.cmd`/PowerShell staging, different enough
  from the mac path to be their own follow-up.

## planned

- riscv64
- android64
- iOS

## docs

- https://v8.dev/docs/compile-arm64
- https://v8.dev/docs/build
- https://v8.dev/docs/build-gn

## release schedule

- https://chromiumdash.appspot.com/schedule

## github actions runner images actually used by this repo's CI

- `linux (x64)` → `ubuntu-22.04` → https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2204-Readme.md
- `linux (arm64)` → `ubuntu-22.04-arm` → https://github.com/actions/partner-runner-images/blob/main/images/arm-ubuntu-22-image.md (a different repo than the x64 image above - GitHub's Arm-partner images aren't documented in `actions/runner-images`)
- `mac (x64 + arm64)` → `macos-15` → https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md
- `windows (x64)` → `windows-2022` → https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md

## build instructions

- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/windows_build_instructions.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/android_build_instructions.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/ios/build_instructions.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/build_instructions.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/chromium_arm.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/sysroot.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/mac_build_instructions.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/mac_arm64.md
