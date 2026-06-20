#!/usr/bin/env bash
# Build the C++ (KDL + ruckig) → WebAssembly measurement-instrument kernel
# (ADR-053 §4). Output (robotics_engine.mjs + .wasm) is written to
# src/engine/robotics-wasm/ and COMMITTED to git — same policy as the Rust
# wasm-engine (ADR-027): the WASM artifact is checked in so `vite build` (and
# GitHub Pages CI) never needs a C++ toolchain.
#
# Prerequisites (provisioned by scripts/setup-toolchain.sh):
#   - Emscripten SDK activated  (emcc on PATH, or EMSDK_DIR/emsdk_env.sh sourced)
#   - vendor submodules present  (git submodule update --init --recursive)
#
# Usage: pnpm build:robotics-wasm   (or run this script directly)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/robotics-wasm"
OUT_DIR="$ROOT/src/engine/robotics-wasm"
BUILD_DIR="$SRC_DIR/build"

# --- locate Emscripten -------------------------------------------------------
if ! command -v emcc >/dev/null 2>&1; then
  EMSDK_DIR="${EMSDK_DIR:-/opt/emsdk}"
  if [ -f "$EMSDK_DIR/emsdk_env.sh" ]; then
    # shellcheck disable=SC1091
    source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
  fi
fi
if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc not found. Run scripts/setup-toolchain.sh first " \
       "(or set EMSDK_DIR to your emsdk checkout)." >&2
  exit 1
fi

# --- ensure vendored sources -------------------------------------------------
if [ ! -f "$SRC_DIR/vendor/ruckig/include/ruckig/ruckig.hpp" ]; then
  echo "vendor submodules missing — running git submodule update --init ..." >&2
  git -C "$ROOT" submodule update --init --recursive robotics-wasm/vendor
fi

# --- configure + build -------------------------------------------------------
mkdir -p "$BUILD_DIR" "$OUT_DIR"
emcmake cmake -S "$SRC_DIR" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release
emmake make -C "$BUILD_DIR" -j"$(nproc)"

# --- publish artifacts -------------------------------------------------------
cp "$BUILD_DIR/robotics_engine.mjs"  "$OUT_DIR/"
cp "$BUILD_DIR/robotics_engine.wasm" "$OUT_DIR/"

echo "robotics-wasm build complete → $OUT_DIR"
ls -la "$OUT_DIR"/robotics_engine.*
