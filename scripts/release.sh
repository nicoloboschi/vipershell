#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# ── Load NPM token from .env ──
if [ -f .env ]; then
  export $(grep -E '^NPM_TOKEN=' .env | xargs)
fi

if [ -z "${NPM_TOKEN:-}" ]; then
  echo "Error: NPM_TOKEN not set. Add NPM_TOKEN=... to .env"
  exit 1
fi

# ── Safety: ensure .env is not tracked ──
if git ls-files --error-unmatch .env 2>/dev/null; then
  echo "Error: .env is tracked by git! Remove it first: git rm --cached .env"
  exit 1
fi

# ── Check for uncommitted changes ──
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: uncommitted changes. Commit or stash first."
  git status --short
  exit 1
fi

# ── Build ──
echo "Building..."
npm run build

# ── Read version ──
VERSION=$(node -p "require('./package.json').version")
echo "Publishing vipershell@${VERSION}"

# ── Publish ──
NPM_CONFIG_//registry.npmjs.org/:_authToken="${NPM_TOKEN}" npm publish --access public

echo ""
echo "Published vipershell@${VERSION}"
echo "Users can now run: npx vipershell"
