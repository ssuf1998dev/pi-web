# Isolate project command environments from the web host

Pi Web sanitizes the environment of its built-in project shells instead of exposing the Next.js host runtime wholesale. The agent `bash` tool and direct user shell commands remove `PORT`, `NODE_ENV`, `NEXT_*`, and the host's own login credentials while preserving the SDK-managed PATH, Pi session metadata, and all other inherited values; explicit variables set by a project command still take effect. The built-in terminal keeps the host environment but also omits those credentials. Third-party extensions retain control of their own tools and subprocesses so existing overrides and remote execution integrations are not intercepted.

The credential list is `PI_WEB_PASSWORD` and, since ADR 0007, `PI_WEB_OIDC_CLIENT_SECRET`; it lives in `lib/host-credentials.ts`, and an `mcp.json` entry that reads either is refused outright (ADR 0006, "Safety → Environment").
