#!/usr/bin/env bash
# Optional encoders absent from Debian FFmpeg. Sources are pinned.
set -euo pipefail
cd "$(dirname "$0")/.."
prefix="${CODECS_PREFIX:-$PWD/.runtime/audio-codecs}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$prefix/bin" "$prefix/share/licenses" "$prefix/share/source"
checkout() {
  git init -q "$work/$1"
  git -C "$work/$1" remote add origin "$2"
  git -C "$work/$1" fetch -q --depth 1 origin "$3"
  git -C "$work/$1" checkout -q --detach FETCH_HEAD
  test "$(git -C "$work/$1" rev-parse HEAD)" = "$3"
}
checkout mac https://github.com/sbooth/CXXMonkeysAudio.git a33138a7bff0ef65dfa67f2a25463e201d7dff64
checkout sox https://github.com/mansr/sox.git 0be259eaa9ce3f3fa587a3ef0cf2c0b9c73167a2
# The fork's CMake lists predate its DSD sources; mirror its autotools lists.
python3 - "$work/sox/src/CMakeLists.txt" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text().replace('  math(EXPR ver "100 * ${major} + ${minor}")', '  set(ver 9999)')
s = s.replace('set(effects_srcs\n', 'set(effects_srcs\n  dop\n  sdm\n')
s = s.replace('set(formats_srcs\n', 'set(formats_srcs\n  dsf\n  dsdiff\n')
p.write_text(s)
PY
cp scripts/ape-encoder.cpp "$work/mac/ape-encoder.cpp"
cat > "$work/mac/CMakeLists.txt" <<'CMAKE'
cmake_minimum_required(VERSION 3.10)
project(qws_mac LANGUAGES CXX)
file(GLOB_RECURSE sdk_sources Sources/MAC/*.cpp)
add_executable(mac ape-encoder.cpp ${sdk_sources})
target_compile_features(mac PRIVATE cxx_std_17)
target_compile_definitions(mac PRIVATE PLATFORM_LINUX _FILE_OFFSET_BITS=64)
target_include_directories(mac PRIVATE Sources/MAC/include Sources/MAC/include/MAC Sources/MAC/MACLib Sources/MAC/Shared)
find_package(Threads REQUIRED)
target_link_libraries(mac PRIVATE Threads::Threads)
CMAKE
cmake -S "$work/mac" -B "$work/mac-build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$work/mac-build" --target mac -j 2
cmake -S "$work/sox" -B "$work/sox-build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$work/sox-build" --target sox -j 2
cp "$work/mac-build/mac" "$prefix/bin/qws-mac"
cp "$work/sox-build/src/sox" "$prefix/bin/sox-dsd"
cp "$work/mac/LICENSE.txt" "$prefix/share/licenses/monkeys-audio.txt"
cp "$work/sox/COPYING" "$prefix/share/licenses/sox.txt"
cp "$work/sox/LICENSE.GPL" "$prefix/share/licenses/sox-gpl.txt"
cp "$work/sox/LICENSE.LGPL" "$prefix/share/licenses/sox-lgpl.txt"
# Include corresponding sources, including the CMake adjustments, in the image.
tar --exclude=.git -czf "$prefix/share/source/monkeys-audio.tar.gz" -C "$work" mac
tar --exclude=.git -czf "$prefix/share/source/sox-dsd.tar.gz" -C "$work" sox
echo "APE and DSD encoders installed in $prefix"
