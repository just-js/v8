#!/usr/bin/env bash
# Installs the host-level prerequisites building V8 locally needs before
# depot_tools/gclient/gn/ninja can even run - the Linux equivalent of
# install-llvm.cmd's role on Windows (a standalone, runnable-by-anyone
# bootstrap step, not just something CI happens to have preinstalled).
# Doesn't touch V8 itself - v8/build/install-build-deps.sh (part of the
# V8 checkout, invoked by tools/build-linux-local.js) handles V8's own,
# much larger dependency list; this script only covers what has to exist
# *before* you can even `git clone` depot_tools and run `fetch v8`.
#
# Usage: ./install-deps.sh
#   then: node tools/build-linux-local.js <x64|arm64> [v8-version]
#
# Debian/Ubuntu only for now (apt-based) - matches every runner/container
# this repo's own CI actually builds on (ubuntu-22.04, ubuntu-22.04-arm,
# and lo's own ubuntu:22.04/alpine:3.23 Docker images). Errors clearly on
# anything else rather than guessing a package manager.
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "error: install-deps.sh only supports apt-based systems (Debian/Ubuntu) today." >&2
  echo "no apt-get found on this machine - install these by hand instead:" >&2
  echo "  git python3 curl ca-certificates lsb-release build-essential" >&2
  exit 1
fi

SUDO=""
if [ "$(id -u)" != "0" ]; then
  command -v sudo >/dev/null 2>&1 || { echo "error: not root and no sudo available" >&2; exit 1; }
  SUDO="sudo"
fi

# git/curl/ca-certificates: fetching depot_tools and V8 itself.
# python3: depot_tools' own tooling (gclient, fetch, gn's own scripts)
# is Python throughout - confirmed directly, this is not optional.
# lsb-release: several depot_tools/Chromium build scripts probe this to
# detect the distro/version (same thing lo's own Dockerfile.ubuntu
# installs it for, for apt.llvm.org's llvm.sh).
# build-essential: provides gcc/g++/make - needed as the *host* compiler
# for arm64's bootstrap-clang-from-source step (tools/build-linux-local.js
# passes CC=gcc/CXX=g++ there, matching CI exactly) even though V8 itself
# is ultimately compiled with its own hermetic clang, not this.
PACKAGES="git python3 curl ca-certificates lsb-release build-essential"

echo "installing: $PACKAGES"
$SUDO apt-get update
$SUDO apt-get install -y --no-install-recommends $PACKAGES

echo
echo "done. versions:"
git --version
python3 --version
curl --version | head -1
gcc --version | head -1
