#
# Building V8 for alpine is a real pain. We have to compile from source, because it has to be
# linked against musl, and we also have to recompile some of the build tools as the official
# build workflow tends to assume glibc by including vendored tools that link against it.
#
# The general strategy is this:
#
#   1. Build GN for alpine (this is a build dependency)
#   2. Use depot_tools to fetch the V8 source and dependencies (needs glibc)
#   3. Build V8 for alpine
#
# STEP 1
# Build GN for alpine
#
FROM alpine:3.18 as gn-builder

ARG GN_COMMIT=9a45b61238317b09b778c47555527c9926700e0c

RUN echo 1

RUN apk add --update --virtual .gn-build-dependencies \
    alpine-sdk \
    binutils-gold \
    clang \
    curl \
    git \
    llvm \
    ninja \
    python3 \
    tar \
    xz

  # Two quick fixes: we need the LLVM tooling in $PATH, and we
  # also have to use gold instead of ld.
RUN PATH=$PATH:/usr/lib/llvm17/bin \
  && cp -f /usr/bin/ld.gold /usr/bin/ld \

  # Clone and build gn
  && git clone https://gn.googlesource.com/gn /tmp/gn \
  && git -C /tmp/gn checkout ${GN_COMMIT} \
  && cd /tmp/gn \
  && python build/gen.py \
  && ninja -C out \
  && cp -f /tmp/gn/out/gn /usr/local/bin/gn \

  # Remove build dependencies and temporary files
  && apk del .gn-build-dependencies \
  && rm -rf /tmp/* /var/tmp/* /var/cache/apk/*

#
# STEP 2
# Use depot_tools to fetch the V8 source and dependencies
#
# The depot_tools scripts have a hard dependency on glibc (or at least a soft one that I didn't
# bother figuring out). Fortunately we only need it to actually download the source and its dependencies
# so we can do this in a place with glibc, and then pass the results on to an alpine builder.
#
FROM debian:10 as source

# The V8 version we want to use. It's assumed that this will be a version tag, but it's just
# used as "git commit $V8_VERSION" so anything that git can resolve will work.
ARG V8_VERSION=12.0

RUN \
  set -x && \
  apt-get update && \
  apt-get install -y \
    git \
    curl \
    python3 && \

  # Clone depot_tools
  git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git /tmp/depot_tools && \
  PATH=$PATH:/tmp/depot_tools

  # fetch V8
RUN  export PATH=$PATH:/tmp/depot_tools && cd /tmp && \
  fetch v8 && \
  cd /tmp/v8 && \
  git checkout branch-heads/${V8_VERSION} && \
  gclient sync

  # cleanup
RUN  apt-get remove --purge -y \
    git \
    curl \
    python3 && \
  apt-get autoremove -y && \
  rm -rf /var/lib/apt/lists/*

FROM alpine:3.18 as v8

WORKDIR /build/v8

COPY --from=source /tmp/v8 /build/v8
COPY --from=gn-builder /usr/local/bin/gn /build/v8/buildtools/linux64/gn

RUN \
  apk add --update \
    curl \
    g++ \
    gcc \
    glib-dev \
    icu-dev \
    libstdc++ \
    linux-headers \
    make \
    ninja \
    python \
    tar \
    xz

RUN ./tools/dev/v8gen.py x64.release -- target_os=\"linux\" target_cpu=\"x64\" v8_target_cpu=\"x64\" v8_use_external_startup_data=false v8_enable_future=true is_official_build=false is_component_build=false is_cfi=false is_asan=false is_clang=false use_custom_libcxx=false use_custom_libcxx_for_host=false use_sysroot=false use_gold=false is_debug=false treat_warnings_as_errors=false v8_enable_i18n_support=false symbol_level=0 v8_static_library=true v8_monolithic=true proprietary_codecs=false toolkit_views=false use_aura=false use_dbus=false use_gio=false use_glib=false use_ozone=false use_udev=false clang_use_chrome_plugins=false v8_deprecation_warnings=false v8_enable_gdbjit=false v8_imminent_deprecation_warnings=false v8_scriptormodule_legacy_lifetime=true v8_enable_sandbox=false use_dummy_lastchange=true use_debug_fission=false v8_enable_snapshot_compression=false v8_enable_javascript_promise_hooks=true v8_promise_internal_field_count=1 v8_enable_handle_zapping=false v8_typed_array_max_size_in_heap=0 v8_enable_shared_ro_heap=false v8_enable_verify_heap=false v8_enable_pointer_compression=false v8_enable_maglev=false

RUN ninja v8_monolith -C out.gn/x64.release/ -j $(getconf _NPROCESSORS_ONLN)
