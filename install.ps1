$ErrorActionPreference = "Stop"
# GodMode one-liner: iex (irm https://raw.githubusercontent.com/fernandogarzaaa/godmode/main/install.ps1)
$dst = Join-Path $HOME ".godmode\src"
if (Test-Path (Join-Path $dst ".git")) { git -C $dst pull --ff-only } else { git clone https://github.com/fernandogarzaaa/godmode $dst }
Set-Location $dst
node --version
npm install --omit=dev
# better-sqlite3 is an optionalDependency but required for the hash-chained
# audit ledger; npm can silently skip optional deps on flaky networks, and
# `doctor` only warns. Install it explicitly (non-fatal: doctor reports it).
npm install --no-save better-sqlite3
if ($LASTEXITCODE -ne 0) { Write-Warning "better-sqlite3 not installed; genesis ledger disabled (see 'node bin/godmode.js doctor')" }
node bin/godmode.js doctor
Write-Output "godmode installed at $dst"
