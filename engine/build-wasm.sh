#!/usr/bin/env bash
# Compiles the PlantSim engine to a standalone WebAssembly module for the browser studio.
# Needs the Emscripten SDK on PATH (https://emscripten.org/docs/getting_started/downloads.html):
#   source /path/to/emsdk/emsdk_env.sh && ./build-wasm.sh
# The output has no JavaScript glue: frontend/src/lib/sim/engine.ts instantiates it directly.
set -euo pipefail
cd "$(dirname "$0")"
OUT=../frontend/public/engine
mkdir -p "$OUT"
em++ -O3 -std=c++17 -fno-exceptions -fno-rtti \
  src/plantsim.cpp src/api.cpp \
  -o "$OUT/plantsim.wasm" \
  --no-entry -sSTANDALONE_WASM=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16MB \
  -sEXPORTED_FUNCTIONS=_rc_alloc,_rc_free,_rc_version,_rc_simulate,_rc_poles,_rc_bode,_rc_lqr,_rc_fit,_rc_ss2tf
ls -l "$OUT/plantsim.wasm"
