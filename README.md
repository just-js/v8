# v8 monolithic library builds

this repo containes up-to-date builds of the google v8 monolithic libraries for the following platforms

contributions are welcome!

# current release

- [tag](https://github.com/just-js/v8/releases/tag/14.8)
- [v8 headers](https://github.com/just-js/v8/releases/download/14.8/include.tar.gz)
- [v8 source](https://github.com/just-js/v8/releases/download/14.8/src.tar.gz)

## linux x64 ✅

- [static libraries](https://github.com/just-js/v8/releases/download/14.8/libv8_monolith-linux-x64.a.gz)
- [build args](args.linux.x64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/14.8/gen-linux-x64.tar.gz)

## linux arm64 ✅

- [static libraries](https://github.com/just-js/v8/releases/download/14.8/libv8_monolith-linux-arm64.a.gz)
- [build args](args.linux.arm64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/14.8/gen-linux-arm64.tar.gz)

## macos x64 ✅

- [static libraries](https://github.com/just-js/v8/releases/download/14.8/libv8_monolith-mac-x64.a.gz)
- [build args](args.mac.x64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/14.8/gen-mac-x64.tar.gz)

## macos arm64 ✅

- [static libraries](https://github.com/just-js/v8/releases/download/14.8/libv8_monolith-mac-arm64.a.gz)
- [build args](args.mac.arm64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/14.8/gen-mac-arm64.tar.gz)

## windows x64 ✅

- [static library](https://github.com/just-js/v8/releases/download/14.8/libv8_monolith-win-x64.zip)
- [build args](args.win.x64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/14.8/gen-win-x64.zip)
- [libc++ headers](https://github.com/just-js/v8/releases/download/14.8/libcxx-headers-win-x64.zip) (needed to link `v8_monolith.lib` against a libc++-built consumer — see `LO-WINDOWS.md` in the `claude` sandbox repo for the full story)

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
