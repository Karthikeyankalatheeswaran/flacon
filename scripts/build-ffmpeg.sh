#!/usr/bin/env bash
# Builds the minimal LGPL-2.1 ffmpeg (decode-only, libsoxr resampling) that Flacon ships. macOS; needs `brew install libsoxr`.
# Output: vendor/ffmpeg/<platform>-<arch>/{ffmpeg,libsoxr.0.dylib}. libsoxr (LGPL) is linked dynamically so users can relink.
# Source offer: https://ffmpeg.org/releases/ffmpeg-$VER.tar.xz (unmodified). Windows: build the same flags under MSYS2.
set -euo pipefail
VER=${FFMPEG_VERSION:-7.1.1}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ARCH=$(uname -m | sed 's/x86_64/x64/')
OUT="$ROOT/vendor/ffmpeg/darwin-$ARCH"
S=$(brew --prefix libsoxr)
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
curl -sSLf --retry 5 --retry-delay 3 --retry-all-errors -o "$W/ff.tar.xz" "https://ffmpeg.org/releases/ffmpeg-$VER.tar.xz"
tar xf "$W/ff.tar.xz" -C "$W"
cd "$W/ffmpeg-$VER"
./configure --disable-everything --disable-autodetect --disable-doc --disable-debug --disable-network --disable-ffplay --disable-ffprobe \
  --enable-ffmpeg --enable-libsoxr --enable-swresample --extra-cflags="-I$S/include" --extra-ldflags="-L$S/lib -Wl,-rpath,@executable_path" \
  --enable-protocol=file,pipe --enable-demuxer=flac,wav,aiff,mov,mp3,ogg,matroska,dsf,ape,wv,caf,aac,w64 \
  --enable-parser=flac,mpegaudio,aac,vorbis,opus \
  --enable-decoder=flac,alac,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_u8,mp3,mp3float,aac,vorbis,opus,dsd_lsbf,dsd_msbf,dsd_lsbf_planar,dsd_msbf_planar,ape,wavpack \
  --enable-filter=aresample,aformat,anull,volume --enable-muxer=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,flac,null --enable-encoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le
make -j"$(sysctl -n hw.ncpu)"
mkdir -p "$OUT"
cp ffmpeg "$OUT/ffmpeg"; cp -L "$S/lib/libsoxr.0.dylib" "$OUT/"; chmod u+w "$OUT"/*
install_name_tool -id @rpath/libsoxr.0.dylib "$OUT/libsoxr.0.dylib"
install_name_tool -change "$S/lib/libsoxr.0.dylib" @rpath/libsoxr.0.dylib "$OUT/ffmpeg" 2>/dev/null || true
codesign --force -s - "$OUT/libsoxr.0.dylib" "$OUT/ffmpeg"   # re-signed with the app's identity at package time
node "$ROOT/scripts/check-ffmpeg-license.mjs" "$OUT/ffmpeg"
