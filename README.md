# v8 monolithic library builds

this repo containes up-to-date builds of the google v8 static libraries for the following platforms

- linux (x64) - tested on ubunutu 22.04
- linux (arm64) - tested on raspberry pi 3b+ raspbian(debian 12/bookworm)
- macos (x64)
- macos (arm64)
- windows (x64)

# current release

https://github.com/just-js/v8/releases/tag/14.2

- [v8 headers](https://github.com/just-js/v8/releases/download/14.2/include.tar.gz)
- [v8 source](https://github.com/just-js/v8/releases/download/14.2/src.tar.gz)

## linux x64 (gcc) ✅

A build of the v8 monolithic library for x64 using gcc

- [static libraries](https://github.com/just-js/v8/releases/download/14.2/libv8_monolith-linux-x64.a.gz)
- [build args](args.linux.x64.gcc.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/14.2/gen-linux-x64.tar.gz)

## linux x64 (clang) ❌

A build of the v8 monolithic library for x64 using clang

- [static libraries](https://github.com/just-js/v8/releases/download/14.2/libv8_monolith-linux-x64-clang.a.gz)
- [build args](args.linux.x64.clang.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/14.2/gen-linux-x64-clang.tar.gz)

## linux arm64 (gcc) ❌

A build of the v8 monolithic library for arm64 using gcc

- [static libraries](https://github.com/just-js/v8/releases/download/14.2/libv8_monolith-linux-arm64.a.gz)
- [build args](args.linux.arm64.gcc.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/14.2/gen-linux-arm64.tar.gz)

## linux arm64 (clang) ❌

A build of the v8 monolithic library for arm64 using clang

- [static libraries](https://github.com/just-js/v8/releases/download/14.2/libv8_monolith-linux-arm64-clang.a.gz)
- [build args](args.linux.arm64.clang.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/14.2/gen-linux-arm64-clang.tar.gz)

## macos x64

A build of the v8 monolithic library for macos x64 using clang

- [static libraries](https://github.com/just-js/v8/releases/download/14.2/libv8_monolith-mac-x64.a.gz)
- [build args](args.mac.x64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/14.2/gen-mac-x64.tar.gz)

## macos arm64

A build of the v8 monolithic library macos arm64 using clang

- [static libraries](https://github.com/just-js/v8/releases/download/14.2/libv8_monolith-mac-arm64.a.gz)
- [build args](args.mac.arm64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/14.2/gen-mac-arm64.tar.gz)

## windows x64

A build of the v8 monolithic library for windows x64 using clang

- [static library](https://github.com/just-js/v8/releases/download/14.2/libv8_monolith-win-x64.zip)
- [build args](args.win.x64.gn)
- [generated source code](https://github.com/just-js/v8/releases/download/14.2/gen-win-x64.zip)

## docs

- https://v8.dev/docs/compile-arm64
- https://v8.dev/docs/build
- https://v8.dev/docs/build-gn

## release schedule

- https://chromiumdash.appspot.com/schedule

## github actions images

- https://github.com/actions/runner-images/blob/main/images/macos/macos-14-Readme.md
- https://github.com/actions/runner-images/blob/main/images/macos/macos-14-arm64-Readme.md
- https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md
- https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md
- https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2204-Readme.md
- https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md
- https://github.com/actions/runner-images/blob/main/images/windows/Windows2019-Readme.md
- https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md
- https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md

## build instructions

- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/windows_build_instructions.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/android_build_instructions.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/ios/build_instructions.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/build_instructions.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/chromium_arm.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/sysroot.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/mac_build_instructions.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/mac_arm64.md