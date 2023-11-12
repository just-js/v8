# v8 monolithic library builds

this repo containes up-to-date monolithic builds of the google v8 static library for the following platforms

- linux (x64) - tested on ubunutu 22.04
- linux (arm64) - tested on raspberry pi 3b+/raspbian
- macos (x64)
- macos (arm64)
- windows (x64)

# current release

https://github.com/just-js/v8/releases/tag/12.0

- [v8 headers](https://github.com/just-js/v8/releases/download/12.0/include.tar.gz)

## linux x64

- [static library](https://github.com/just-js/v8/releases/download/12.0/libv8_monolith-linux-x64.a.tar.gz)
- [build args](args.linux.x64.gn)

## linux arm64
- [static library](https://github.com/just-js/v8/releases/download/12.0/libv8_monolith-linux-arm64.a.tar.gz)
- [build args](args.linux.arm64.gn)

## macos x64
- [static library](https://github.com/just-js/v8/releases/download/12.0/libv8_monolith-mac-x64.a.tar.gz)
- [build args](args.mac.x64.gn)

## macos arm64
- [static library](https://github.com/just-js/v8/releases/download/12.0/libv8_monolith-mac-arm64.a.tar.gz)
- [build args](args.mac.arm64.gn)

## windows x64
- [static library](https://github.com/just-js/v8/releases/download/12.0/v8_monolith-win-x64.lib.tar.gz)
- [build args](args.win.x64.gn)
