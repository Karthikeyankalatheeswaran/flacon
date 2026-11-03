#!/usr/bin/env bash
# Windows x64 counterpart of build-ffmpeg.sh. Run inside an MSYS2 MINGW64 shell:
#   pacman -S --needed --noconfirm base-devel mingw-w64-x86_64-toolchain mingw-w64-x86_64-libsoxr mingw-w64-x86_64-pkgconf curl xz
# Output: vendor/ffmpeg/win32-x64/{ffmpeg.exe,libsoxr*.dll,...}. Same LGPL-2.1, decode-only feature set; libsoxr stays a separate DLL.
set -euo pipefail
VER=${FFMPEG_VERSION:-7.1.1}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/vendor/ffmpeg/win32-x64"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
curl -sSLf --retry 5 --retry-delay 3 --retry-all-errors -o "$W/ff.tar.xz" "https://ffmpeg.org/releases/ffmpeg-$VER.tar.xz"
tar xf "$W/ff.tar.xz" -C "$W"
cd "$W/ffmpeg-$VER"
./configure --arch=x86_64 --target-os=mingw32 --disable-everything --disable-autodetect --disable-doc --disable-debug --disable-network --disable-ffplay --disable-ffprobe \
  --enable-ffmpeg --enable-libsoxr --enable-swresample \
  --enable-protocol=file,pipe --enable-demuxer=flac,wav,aiff,mov,mp3,ogg,matroska,dsf,ape,wv,caf,aac,w64 \
  --enable-parser=flac,mpegaudio,aac,vorbis,opus \
  --enable-decoder=flac,alac,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_u8,mp3,mp3float,aac,vorbis,opus,dsd_lsbf,dsd_msbf,dsd_lsbf_planar,dsd_msbf_planar,ape,wavpack \
  --enable-filter=aresample,aformat,anull,volume --enable-muxer=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,flac,null --enable-encoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le
make -j"$(nproc)"
mkdir -p "$OUT"; cp ffmpeg.exe "$OUT/"
# Ship every non-system DLL ffmpeg needs (libsoxr + its runtime deps) beside the exe.
ldd ffmpeg.exe | awk '/mingw64/ {print $3}' | while read -r dll; do cp "$dll" "$OUT/"; done
node "$ROOT/scripts/check-ffmpeg-license.mjs" "$OUT/ffmpeg.exe"
