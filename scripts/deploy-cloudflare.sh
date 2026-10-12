#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_RUNTIME_DIR="/Users/xionglinpeng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
VINEXT_ESBUILD_SOURCE="$PROJECT_ROOT/node_modules/@esbuild/darwin-arm64/bin/esbuild"
WRANGLER_ESBUILD_PACKAGE="$PROJECT_ROOT/node_modules/wrangler/node_modules/@esbuild/darwin-arm64"
WRANGLER_CONFIG="$PROJECT_ROOT/wrangler.deploy.jsonc"
DRY_RUN_ONLY=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN_ONLY=true
elif [[ "$#" -gt 0 ]]; then
  printf 'Usage: bash scripts/deploy-cloudflare.sh [--dry-run]\n' >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1 && [[ -x "$NODE_RUNTIME_DIR/node" ]]; then
  export PATH="$NODE_RUNTIME_DIR:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js was not found. Install Node.js or configure the bundled runtime path in this script.\n' >&2
  exit 1
fi

if [[ "$(uname -s)-$(uname -m)" != "Darwin-arm64" ]]; then
  printf 'This release helper currently expects the project’s macOS Apple Silicon esbuild package.\n' >&2
  exit 1
fi

if [[ ! -x "$VINEXT_ESBUILD_SOURCE" ]]; then
  printf 'The locked esbuild binary is missing. Restore project dependencies before deploying.\n' >&2
  exit 1
fi

ESBUILD_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/asset-allocation-esbuild.XXXXXX")"

cleanup() {
  rm -rf "$ESBUILD_TEMP_DIR"
}
trap cleanup EXIT

VINEXT_ESBUILD_VERSION="$(node -p "require('$PROJECT_ROOT/node_modules/esbuild/package.json').version")"
WRANGLER_ESBUILD_VERSION="$(node -p "require('$PROJECT_ROOT/node_modules/wrangler/node_modules/esbuild/package.json').version")"
VINEXT_ESBUILD_TEMP="$ESBUILD_TEMP_DIR/vinext-esbuild"
WRANGLER_ESBUILD_TEMP="$ESBUILD_TEMP_DIR/wrangler-esbuild"
mkdir -p "$ESBUILD_TEMP_DIR/package"

prepare_esbuild() {
  local source="$1"
  local destination="$2"
  local expected_version="$3"
  if [[ ! -x "$source" ]]; then
    printf 'The locked esbuild binary is missing: %s\n' "$source" >&2
    exit 1
  fi
  cp "$source" "$destination"
  if command -v xattr >/dev/null 2>&1; then
    xattr -d com.apple.quarantine "$destination" 2>/dev/null || true
  fi
  local actual_version
  actual_version="$("$destination" --version)"
  if [[ "$actual_version" != "$expected_version" ]]; then
    printf 'esbuild version mismatch: expected %s, got %s.\n' "$expected_version" "$actual_version" >&2
    exit 1
  fi
}

prepare_esbuild "$VINEXT_ESBUILD_SOURCE" "$VINEXT_ESBUILD_TEMP" "$VINEXT_ESBUILD_VERSION"

WRANGLER_ESBUILD_SOURCE="$WRANGLER_ESBUILD_PACKAGE/bin/esbuild"
if [[ ! -x "$WRANGLER_ESBUILD_SOURCE" ]]; then
  if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
    printf 'Wrangler’s matching esbuild binary is absent, and curl/tar are required to fetch its locked package.\n' >&2
    exit 1
  fi
  WRANGLER_ESBUILD_TARBALL="$ESBUILD_TEMP_DIR/wrangler-esbuild.tgz"
  curl -fsSL "https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-${WRANGLER_ESBUILD_VERSION}.tgz" -o "$WRANGLER_ESBUILD_TARBALL"
  tar -xzf "$WRANGLER_ESBUILD_TARBALL" -C "$ESBUILD_TEMP_DIR/package"
  WRANGLER_ESBUILD_SOURCE="$ESBUILD_TEMP_DIR/package/package/bin/esbuild"
fi
prepare_esbuild "$WRANGLER_ESBUILD_SOURCE" "$WRANGLER_ESBUILD_TEMP" "$WRANGLER_ESBUILD_VERSION"

cd "$PROJECT_ROOT"

printf '\n== Build ==\n'
ESBUILD_BINARY_PATH="$VINEXT_ESBUILD_TEMP" "$PROJECT_ROOT/node_modules/.bin/vinext" build

printf '\n== Cloudflare preflight ==\n'
ESBUILD_BINARY_PATH="$WRANGLER_ESBUILD_TEMP" "$PROJECT_ROOT/node_modules/.bin/wrangler" deploy --config "$WRANGLER_CONFIG" --dry-run

if [[ "$DRY_RUN_ONLY" == true ]]; then
  printf '\nDry run passed; no deployment was made.\n'
  exit 0
fi

printf '\n== Deploy Cloudflare main site ==\n'
ESBUILD_BINARY_PATH="$WRANGLER_ESBUILD_TEMP" "$PROJECT_ROOT/node_modules/.bin/wrangler" deploy --config "$WRANGLER_CONFIG"
