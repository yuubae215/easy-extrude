#!/usr/bin/env bash
# Provision the WASM build toolchains for easy-extrude (ADR-053 §11).
# Idempotent — safe to re-run. Designed to bootstrap a fresh / ephemeral
# container (e.g. Claude Code on the web) so both WASM lanes can build:
#
#   1. Rust  → wasm-pack   (wasm-engine/, ADR-027)
#   2. C++   → Emscripten  (robotics-wasm/ : KDL + ruckig, ADR-053)
#
# Neither lane is needed for `vite build` (both ship committed artifacts), but
# this script is what you run before regenerating those artifacts.
#
# Usage:  pnpm setup:toolchain   (or: bash scripts/setup-toolchain.sh)
# Env:    EMSDK_DIR   where to install the Emscripten SDK (default /opt/emsdk)
#         WASM_PACK_VERSION  pinned wasm-pack release (default v0.13.1)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_DIR="${EMSDK_DIR:-/opt/emsdk}"
WASM_PACK_VERSION="${WASM_PACK_VERSION:-v0.13.1}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# --- 1. Rust wasm target + wasm-pack -----------------------------------------
log "Rust wasm32 target"
if command -v rustup >/dev/null 2>&1; then
  rustup target add wasm32-unknown-unknown || true
else
  echo "warning: rustup not found — skipping Rust target (install rustup to build wasm-engine)" >&2
fi

log "wasm-pack ${WASM_PACK_VERSION}"
if ! command -v wasm-pack >/dev/null 2>&1; then
  # The official rustwasm.github.io installer is a GitHub Pages URL that may be
  # blocked by network policy; fetch the prebuilt binary from the release asset
  # on github.com directly (works where the Pages domain does not).
  tarball="wasm-pack-${WASM_PACK_VERSION}-x86_64-unknown-linux-musl"
  url="https://github.com/rustwasm/wasm-pack/releases/download/${WASM_PACK_VERSION}/${tarball}.tar.gz"
  dest="${CARGO_HOME:-$HOME/.cargo}/bin"
  mkdir -p "$dest"
  if curl -sSfL "$url" -o "/tmp/${tarball}.tar.gz"; then
    tar -xzf "/tmp/${tarball}.tar.gz" -C /tmp
    install -m 0755 "/tmp/${tarball}/wasm-pack" "$dest/wasm-pack"
  elif command -v cargo >/dev/null 2>&1; then
    echo "release download failed — falling back to cargo install wasm-pack" >&2
    cargo install wasm-pack --version "${WASM_PACK_VERSION#v}"
  else
    echo "error: could not install wasm-pack (no download, no cargo)" >&2
    exit 1
  fi
fi
command -v wasm-pack >/dev/null 2>&1 && wasm-pack --version

# --- 2. Emscripten SDK --------------------------------------------------------
log "Emscripten SDK → ${EMSDK_DIR}"
if [ ! -d "$EMSDK_DIR" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
fi
(
  cd "$EMSDK_DIR"
  ./emsdk install latest
  ./emsdk activate latest
)
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1 || true
command -v emcc >/dev/null 2>&1 && emcc --version | head -1

# --- 3. Vendored C++ submodules ----------------------------------------------
log "Vendor submodules (ruckig / orocos_kdl / eigen)"
git -C "$ROOT" submodule update --init --recursive robotics-wasm/vendor

log "Toolchain ready. Build artifacts with:"
echo "    pnpm build:wasm            # Rust  → wasm-engine"
echo "    pnpm build:robotics-wasm   # C++   → robotics-wasm (KDL + ruckig)"
echo
echo "Add this to your shell to keep emcc on PATH:"
echo "    source \"${EMSDK_DIR}/emsdk_env.sh\""
