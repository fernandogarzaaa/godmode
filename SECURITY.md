# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

Security fixes land on the current release line only.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Use one of these
private channels:

- GitHub: open a **Security Advisory** on this repository
  (Security tab > Advisories > New draft advisory)
- Email: fernandogarzaaa@gmail.com with subject `[godmode security]`

Include a description, steps to reproduce, and the affected version or
commit. Expect an acknowledgement within 72 hours and a fix or mitigation
plan within 14 days for confirmed issues.

## Security Posture

GodMode is a local-first plugin and MCP product engine. Its network surface
is the local console and the MCP server endpoints.

- **Default mode is localhost-only.** The console binds to `127.0.0.1`.
  The MCP server speaks stdio JSON-RPC by default; its optional `--http`
  endpoint also binds to `127.0.0.1`. Nothing listens on a public
  interface in the default configuration.
- **Opt-in bearer auth.** Set `GODMODE_REQUIRE_AUTH=1` and provide tokens
  via `GODMODE_TOKENS` (comma-separated) to require a Bearer token on
  protected endpoints. When no external identity provider is configured, a
  401 response points at the RFC 9728 protected-resource document served
  by the app. A future IdP plugs in via `GODMODE_AUTH_SERVERS` (JSON array).
- **Token handling.** Bearer tokens are compared in memory against the
  `GODMODE_TOKENS` allowlist; they are never logged, persisted, or sent
  anywhere. Use a process manager or secret store for the environment,
  not shell history or checked-in config.
- **Vendored components.** This distribution vendors several components
  (see `NOTICE.md` for the license split). A vulnerability in a vendored
  component is fixed by updating the vendored copy; report it the same way
  and note the component name.
- **No telemetry.** GodMode sends no usage data anywhere. Runs, traces,
  and task state stay on the machine unless you explicitly share them.

## Out of Scope

- Vulnerabilities that require the attacker to already have code execution
  or filesystem write access on the host running GodMode.
- Social-engineering or phishing against operators.
- Denial of service via resource exhaustion on a machine the operator
  already controls.
