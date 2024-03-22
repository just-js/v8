# v8 monolithic library builds

this repo containes up-to-date builds of the google v8 static libraries for the following platforms

- linux (x64) - tested on ubunutu 22.04
- linux (arm64) - tested on raspberry pi 3b+ raspbian(debian 12/bookworm)
- macos (x64)
- macos (arm64)
- windows (x64)

# current release

https://github.com/just-js/v8/releases/tag/12.3

- [v8 headers](https://github.com/just-js/v8/releases/download/12.3/include.tar.gz)

## linux x64

This is a non-monolithic snapshot v8 build and the v8-deps tarball contains all the libs and the builtins snapshot required to build

- [static libraries](https://github.com/just-js/v8/releases/download/12.3/v8-deps-linux-x64.tar.gz)
- [build args](args.linux.x64.gn)
- [generate source code](https://github.com/just-js/v8/releases/download/12.3/gen-linux-x64.tar.gz)

## linux arm64

This is a non-monolithic snapshot v8 build and the v8-deps tarball contains all the libs and the builtins snapshot required to build

- [static libraries](https://github.com/just-js/v8/releases/download/12.3/v8-deps-linux-arm64.tar.gz)
- [build args](args.linux.arm64.gn)
- [generate source code](https://github.com/just-js/v8/releases/download/12.3/gen-linux-arm64.tar.gz)

## macos x64

The macos build for x64 is currently a v8 monolithic build without snapshot support until we can get it to build correctly on CI with these configuration options

- [static libraries](https://github.com/just-js/v8/releases/download/12.3/libv8_monolith-mac-x64.a.tar.gz)
- [build args](args.mac.x64.gn)
- [generate source code](https://github.com/just-js/v8/releases/download/12.3/gen-mac-x64.tar.gz)

## macos arm64

This is a non-monolithic snapshot v8 build and the v8-deps tarball contains all the libs and the builtins snapshot required to build

- [static libraries](https://github.com/just-js/v8/releases/download/12.3/v8-deps-mac-arm64.tar.gz)
- [build args](args.mac.arm64.gn)
- [generate source code](https://github.com/just-js/v8/releases/download/12.3/gen-mac-arm64.tar.gz)

## windows x64

The windows build for x64 is currently a v8 monolithic build without snapshot support until we can get it to build correctly on CI with these configuration options

- [static library](https://github.com/just-js/v8/releases/download/12.3/libv8_monolith-win-x64.lib.tar.gz)
- [build args](args.win.x64.gn)
- [generate source code](https://github.com/just-js/v8/releases/download/12.3/gen-win-x64.tar.gz)


# build instructions

TODO

examples of compiling a bare-bones v8 runtime with the libs for each platform

