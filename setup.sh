#!/bin/sh
# Sets up stacked-studio on macOS or Linux. Safe to run again at any time.
# The real work is in scripts/setup.mjs; this only checks that Node is available.
set -eu
cd "$(dirname "$0")"

need="22.13"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js $need or newer is needed, and it isn't installed."
  case "$(uname -s)" in
    Darwin) echo "Install it with:  brew install node     (or download it from https://nodejs.org)" ;;
    Linux)  echo "Install it with nvm:  https://github.com/nvm-sh/nvm  then  nvm install --lts" ;;
    *)      echo "Download it from https://nodejs.org" ;;
  esac
  echo "Then run ./setup.sh again."
  exit 1
fi

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "Node.js $need or newer is needed (found $(node -v)). Update Node, then run ./setup.sh again."
  exit 1
fi

exec node scripts/setup.mjs "$@"
