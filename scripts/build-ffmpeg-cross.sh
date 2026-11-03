#!/usr/bin/env bash
# Cross-builds the decode-only LGPL ffmpeg + shared libsoxr for another platform, from a macOS arm64 host.
#   scripts/build-ffmpeg-cross.sh darwin-x64 | win32-x64 | win32-arm64
# Needs: cmake (brew), and for win32-* the llvm-mingw toolchain (https://github.com/mstorsjo/llvm-mingw, macOS universal build)
# unpacked at $LLVM_MINGW (default /tmp/xb/llvm-mingw-*-ucrt-macos-universal). Output: vendor/ffmpeg/<target>/.
set -euo pipefail
TARGET=${1:?usage: $0 darwin-x64|win32-x64|win32-arm64}
FFVER=${FFMPEG_VERSION:-7.1.1}
SOXR_VER=0.1.3
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/vendor/ffmpeg/$TARGET"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
dl() { curl -sSLf --retry 5 --retry-delay 3 --retry-all-errors -o "$1" "$2"; }

dl "$W/soxr.tar.xz" "https://downloads.sourceforge.net/project/soxr/soxr-$SOXR_VER-Source.tar.xz"
dl "$W/ff.tar.xz" "https://ffmpeg.org/releases/ffmpeg-$FFVER.tar.xz"
tar xf "$W/soxr.tar.xz" -C "$W"; tar xf "$W/ff.tar.xz" -C "$W"

PREFIX="$W/prefix"; mkdir -p "$PREFIX"
CMAKE_COMMON=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DWITH_OPENMP=OFF -DBUILD_TESTS=OFF -DBUILD_EXAMPLES=OFF -DWITH_LSR_BINDINGS=OFF -DWITH_AVFFT=OFF -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_POLICY_VERSION_MINIMUM=3.5)
FF_COMMON=(--disable-everything --disable-autodetect --disable-doc --disable-debug --disable-network --disable-ffplay --disable-ffprobe
  --enable-ffmpeg --enable-libsoxr --enable-swresample --enable-protocol=file,pipe
  --enable-demuxer=flac,wav,aiff,mov,mp3,ogg,matroska,dsf,ape,wv,caf,aac,w64 --enable-parser=flac,mpegaudio,aac,vorbis,opus
  --enable-decoder=flac,alac,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_u8,mp3,mp3float,aac,vorbis,opus,dsd_lsbf,dsd_msbf,dsd_lsbf_planar,dsd_msbf_planar,ape,wavpack
  --enable-filter=aresample,aformat,anull,volume --enable-muxer=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,flac,null --enable-encoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le)

case "$TARGET" in
  darwin-x64)
    cmake -S "$W/soxr-$SOXR_VER-Source" -B "$W/soxr-build" "${CMAKE_COMMON[@]}" -DCMAKE_OSX_ARCHITECTURES=x86_64 -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 >/dev/null
    cmake --build "$W/soxr-build" -j"$(sysctl -n hw.ncpu)" >/dev/null && cmake --install "$W/soxr-build" >/dev/null
    cd "$W/ffmpeg-$FFVER"
    ./configure --enable-cross-compile --arch=x86_64 --target-os=darwin --cc="clang -arch x86_64" "${FF_COMMON[@]}" \
      --extra-cflags="-arch x86_64 -mmacosx-version-min=11.0 -I$PREFIX/include" --extra-ldflags="-arch x86_64 -mmacosx-version-min=11.0 -L$PREFIX/lib -Wl,-rpath,@executable_path"
    make -j"$(sysctl -n hw.ncpu)"
    mkdir -p "$OUT"; cp ffmpeg "$OUT/ffmpeg"; cp -L "$PREFIX/lib/libsoxr.0.dylib" "$OUT/"; chmod u+w "$OUT"/*
    install_name_tool -id @rpath/libsoxr.0.dylib "$OUT/libsoxr.0.dylib"
    install_name_tool -change "$PREFIX/lib/libsoxr.0.dylib" @rpath/libsoxr.0.dylib "$OUT/ffmpeg" 2>/dev/null || true
    codesign --force -s - "$OUT/libsoxr.0.dylib" "$OUT/ffmpeg"
    ;;
  win32-x64|win32-arm64)
    LLVM_MINGW=${LLVM_MINGW:-$(ls -d /tmp/xb/llvm-mingw-*-ucrt-macos-universal | head -1)}
    export PATH="$LLVM_MINGW/bin:$PATH"
    if [ "$TARGET" = win32-x64 ]; then TRIPLE=x86_64-w64-mingw32; ARCH=x86_64; CPU=AMD64; else TRIPLE=aarch64-w64-mingw32; ARCH=aarch64; CPU=ARM64; fi
    cmake -S "$W/soxr-$SOXR_VER-Source" -B "$W/soxr-build" "${CMAKE_COMMON[@]}" -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=$CPU \
      -DCMAKE_C_COMPILER=$TRIPLE-clang -DCMAKE_RC_COMPILER=$TRIPLE-windres -DCMAKE_AR="$LLVM_MINGW/bin/llvm-ar" -DCMAKE_RANLIB="$LLVM_MINGW/bin/llvm-ranlib" >/dev/null
    cmake --build "$W/soxr-build" -j"$(sysctl -n hw.ncpu)" >/dev/null && cmake --install "$W/soxr-build" >/dev/null
    cd "$W/ffmpeg-$FFVER"
    PKG_CONFIG_PATH="" ./configure --enable-cross-compile --arch=$ARCH --target-os=mingw32 --cross-prefix=$TRIPLE- --cc=$TRIPLE-clang --pkg-config=false "${FF_COMMON[@]}" \
      --extra-cflags="-I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib -L$PREFIX/bin"
    make -j"$(sysctl -n hw.ncpu)"
    mkdir -p "$OUT"; cp ffmpeg.exe "$OUT/"
    cp "$PREFIX"/bin/libsoxr*.dll "$OUT/" 2>/dev/null || cp "$PREFIX"/lib/libsoxr*.dll "$OUT/"
    ;;
  *) echo "unknown target $TARGET" >&2; exit 2 ;;
esac
echo "built $OUT:"; ls -la "$OUT"
