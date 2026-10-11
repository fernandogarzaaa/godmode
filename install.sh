#!/usr/bin/env bash
set -euo pipefail
# GodMode one-liner: curl -fsSL https://raw.githubusercontent.com/fernandogarzaaa/godmode/main/install.sh | bash
DST="${HOME}/.godmode/src"
mkdir -p "$(dirname "$DST")"
if [ -d "$DST/.git" ]; then git -C "$DST" pull --ff-only; else git clone https://github.com/fernandogarzaaa/godmode "$DST"; fi
cd "$DST"
node --version
npm install --omit=dev
# better-sqlite3 is an optionalDependency but required for the hash-chained
# audit ledger; npm can silently skip optional deps on flaky networks, and
# `doctor` only warns. Install it explicitly (non-fatal: doctor reports it).
npm install --no-save better-sqlite3 || echo "WARN: better-sqlite3 not installed; genesis ledger disabled (see 'node bin/godmode.js doctor')"
node bin/godmode.js doctor
echo "godmode installed at $DST — run: $DST/bin/godmode.js"
