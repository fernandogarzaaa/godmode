# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.1] - 2026-10-13

### Fixed
- `godmode run`: exits 1 when the tool is unknown, returns an error, or still needs confirmation (`input_required`); it always exited 0, so scripts and CI could not detect failures.
- `godmode run`: invalid JSON args (`'{bad'`), non-object JSON (`'[1]'`) and stray tokens that are not `key=value` are usage errors (exit 2, message on stderr) instead of silently running the tool with `{}`.
- Unknown commands print usage to stderr and exit 2 (was exit 0); `godmode help` / `--help` / `-h` print usage and exit 0.

### Added
- Dependabot now also checks the root npm package weekly (GitHub Actions were already covered).
- `.env.example` documenting the `GODMODE_*` environment variables (data dir, port, Python, auth, build scripts).
- This changelog.
