#!/bin/bash
set -euo pipefail

echo "Cleaning previous builds..."
rm -rf dist dist_electron release

if [[ "$(uname)" == "Darwin" ]]; then
  export DYLD_LIBRARY_PATH="/opt/homebrew/opt/gettext/lib:/usr/local/opt/gettext/lib:${DYLD_LIBRARY_PATH:-}"
  export DYLD_FALLBACK_LIBRARY_PATH="/opt/homebrew/opt/gettext/lib:/usr/local/opt/gettext/lib:${DYLD_FALLBACK_LIBRARY_PATH:-}"

  if [[ ! -f "/opt/homebrew/opt/gettext/lib/libintl.8.dylib" && ! -f "/usr/local/opt/gettext/lib/libintl.8.dylib" ]]; then
    if command -v brew >/dev/null 2>&1; then
      echo "Installing gettext..."
      brew install gettext || true
      prefix="$(brew --prefix gettext 2>/dev/null || true)"
      if [[ -n "${prefix}" && -d "${prefix}/lib" ]]; then
        export DYLD_LIBRARY_PATH="${prefix}/lib:${DYLD_LIBRARY_PATH:-}"
        export DYLD_FALLBACK_LIBRARY_PATH="${prefix}/lib:${DYLD_FALLBACK_LIBRARY_PATH:-}"
      fi
    else
      echo "gettext not found. Install it then retry:"
      echo "brew install gettext"
    fi
  fi
fi

echo "Rebuilding native dependencies..."
npm rebuild better-sqlite3 sharp || true

echo "Packaging application..."
npm run dist

echo "Build complete! Check dist_electron/ for artifacts."
