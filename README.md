# v8 monolithic library builds

this repo containes up-to-date builds of the google v8 monolithic libraries for the following platforms

contributions are welcome!

# current release

- [tag](https://github.com/just-js/v8/releases/tag/15.2)
- [v8 headers](https://github.com/just-js/v8/releases/download/15.2/include.tar.gz)
- [v8 source](https://github.com/just-js/v8/releases/download/15.2/src.tar.gz)

## linux x64 ✅

- [static libraries](https://github.com/just-js/v8/releases/download/15.2/libv8_monolith-linux-x64.a.gz)
- [build args](args.linux.x64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/15.2/gen-linux-x64.tar.gz)

## linux arm64 ✅

- [static libraries](https://github.com/just-js/v8/releases/download/15.2/libv8_monolith-linux-arm64.a.gz)
- [build args](args.linux.arm64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/15.2/gen-linux-arm64.tar.gz)

## macos x64 ✅

- [static libraries](https://github.com/just-js/v8/releases/download/15.2/libv8_monolith-mac-x64.a.gz)
- [build args](args.mac.x64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/15.2/gen-mac-x64.tar.gz)

## macos arm64 ✅

- [static libraries](https://github.com/just-js/v8/releases/download/15.2/libv8_monolith-mac-arm64.a.gz)
- [build args](args.mac.arm64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/15.2/gen-mac-arm64.tar.gz)

## windows x64 ✅

- [static library](https://github.com/just-js/v8/releases/download/15.2/libv8_monolith-win-x64.zip)
- [build args](args.win.x64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/15.2/gen-win-x64.zip)
- [libc++ headers](https://github.com/just-js/v8/releases/download/15.2/libcxx-headers-win-x64.zip)

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
  node tools/check-patches.js 15.2
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
  node tools/build-mac-local.js arm64        # or x64, defaults to 15.2
  node tools/build-mac-local.js arm64 15.2
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
  Linux/Windows equivalents of *this* script aren't built yet -
  `build.yml`'s own linux job builds `lo` via Docker
  (`docker/Dockerfile.ubuntu`/`.alpine`) and its windows job via
  `build.cmd`/PowerShell staging, different enough from the mac path to
  be their own follow-up.
- **[`install-deps.sh`](install-deps.sh)** - Linux only, Debian/Ubuntu
  (`apt-get`-based). Installs the host-level prerequisites building V8
  locally needs *before* depot_tools/gclient can even run (`git`,
  `python3`, `curl`, `ca-certificates`, `lsb-release`,
  `build-essential`) - the Linux equivalent of `repos/lo`'s own
  `install-llvm.cmd` (a standalone, runnable-by-anyone bootstrap step,
  not something only CI happens to have preinstalled). Doesn't touch V8
  itself - `v8/build/install-build-deps.sh` (part of the V8 checkout,
  invoked by `build-linux-local.js` below) handles V8's own, much larger
  dependency list.
  ```
  ./install-deps.sh
  ```
- **[`tools/build-linux-local.js`](tools/build-linux-local.js)** - Linux
  only. Mirrors `build.yml`'s `build-linux-x64`/`build-linux-arm64` jobs
  step-for-step, including arm64's real extra cost: Chromium only
  publishes a prebuilt hermetic clang for x64 hosts, so arm64 bootstraps
  its own clang from source first (`tools/clang/scripts/build.py`,
  genuinely slow) - cached locally by `tools/clang/scripts/update.py`'s
  hash, same idea as CI's own cache, skipped on a re-run against the same
  checkout. Also builds `d8` and regenerates `compile_commands.json`,
  same as `build-mac-local.js`. `--libcxx` is a placeholder, not yet
  implemented - see PLAN.md task 38 in the outer sandbox repo (Linux
  libc++ option, rescoped 2026-08-24, not yet built).
  ```
  ./install-deps.sh                              # once, if not already set up
  node tools/build-linux-local.js x64             # or arm64, defaults to 15.2
  node tools/build-linux-local.js arm64 15.2
  ```
- **[`tools/build-windows-local.js`](tools/build-windows-local.js)** -
  Windows only. Mirrors `build.yml`'s `build-windows` job step-for-step,
  including the real `BUILD.gn` source patches that job needs (`v8_monolith`
  is a `static_library`, which Chromium's automatic libc++ dependency
  injection never covers - without these, final link fails with dozens of
  real `LNK2019`/`LNK2001`s for libc++ runtime symbols). Requires Visual
  Studio 2026 (or compatible) with the "Desktop development with C++"
  workload already installed - unlike Linux's `install-deps.sh`, nothing
  here installs Visual Studio itself, too heavy/varied to script reliably.
  **Unverified end to end** - written directly from `build.yml`'s real
  steps, but there's no Windows machine anywhere this was tested against.
  ```
  node tools/build-windows-local.js x64
  node tools/build-windows-local.js x64 15.2
  ```
- **[`docker/Dockerfile.ubuntu`](docker/Dockerfile.ubuntu)** - same glibc
  environment as `install-deps.sh` plus Node itself, containerized (same
  pattern as `repos/lo`'s own `docker/Dockerfile.ubuntu`: environment
  only, no source `COPY`, mount the repo in and run
  `build-linux-local.js` against it). Arch-agnostic - `docker run` on an
  arm64 host (e.g. Docker Desktop on Apple Silicon) pulls the arm64
  variant automatically, same image works for both `x64`/`arm64`.
  ```
  docker build -t v8-linux -f docker/Dockerfile.ubuntu .
  docker run --rm -v "$(pwd):/src" -w /src v8-linux node tools/build-linux-local.js x64
  docker run --rm -v "$(pwd):/src" -w /src v8-linux node tools/build-linux-local.js arm64
  ```
- **[`docker/Dockerfile.alpine`](docker/Dockerfile.alpine)** - musl
  environment for building **V8 itself** under musl, for the first time
  in this project (not to be confused with `repos/lo`'s own
  `docker/Dockerfile.alpine`, which never compiles V8 - it links `lo.cc`
  against a prebuilt *glibc* `libv8_monolith.a` via a C-symbol shim, see
  `LO-MUSL.md`/`C++.md`). **Genuinely experimental, not a proven
  recipe** - real, specific, unresolved risks are documented in the
  Dockerfile itself: Chromium's hermetic `gn`/`ninja`/clang binaries are
  almost certainly glibc-linked prebuilts and may not run under musl even
  with `gcompat` installed; `v8/build/install-build-deps.sh` is
  apt-based and skipped entirely on this image (`build-linux-local.js`
  detects the missing `apt-get` and warns rather than crashing); V8's own
  source has never been compiled against musl headers in this project at
  all. Expect the first real run to fail at one of these three points -
  that's the next real thing to fix, not a surprise.
  ```
  docker build -t v8-alpine -f docker/Dockerfile.alpine .
  docker run --rm -v "$(pwd):/src" -w /src v8-alpine node tools/build-linux-local.js x64
  ```

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
