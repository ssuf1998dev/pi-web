# 0007 — OIDC is a second door on the login page, not a replacement for the password

## Status

Accepted.

## Context

Pi Web guards itself with one shared secret: `PI_WEB_PASSWORD`, which is both
what a person types at `/login` and the HMAC key of the session cookie. In an
environment that already has an identity provider (Keycloak, Entra ID, Authelia,
Authentik, Google Workspace), that is the weakest link, and it is the weakest
link on the most dangerous door Pi Web has: the browser lands on a machine
whose agent runs arbitrary shell commands, with a built-in terminal, MCP tools
and Code mode behind it.

Sharing one password means the operator cannot say who is signed in, cannot
revoke one person without signing everyone out, and cannot let the existing SSO
policy (MFA, conditional access, device compliance) reach Pi Web at all.

The obvious move is to swap the password out for OIDC. That is the decision
this ADR declines.

## Decision

**OIDC is an additional way onto the same session, and `PI_WEB_PASSWORD` stays
mandatory.**

- **The signing key does not change.** A successful OIDC login mints the very
  same `pi_web_session` cookie that the password form mints, with byte-identical
  attributes (`HttpOnly`, `SameSite=Lax`, `Secure` by forwarded protocol,
  `Path=/`, `PI_WEB_SESSION_MAX_AGE`). `lib/web-auth.ts` remains the only place
  a session is judged, so the proxy, the SSE streams, `/api/files`, the
  terminal, and the existing logout row in Settings › General need no change.
  Since that key *is* the password variable, OIDC cannot be enabled without it:
  enabling OIDC means `PI_WEB_PASSWORD`, an issuer, a client id, and a
  non-empty allow-list, and anything less leaves OIDC off, the button
  unrendered and the two routes answering 404.
- **The allow-list must be non-empty.** `PI_WEB_OIDC_ALLOWED_SUBJECTS` or
  `PI_WEB_OIDC_ALLOWED_EMAILS` has to name somebody, checked at startup, or OIDC
  is not enabled at all. An empty list would trade "knows the shared password"
  for "holds any account at the identity provider", which on a code-execution
  host is a silent widening of the door, not a narrowing of it. Pi Web would
  rather look misconfigured than open. Matching is exact on `sub` (an
  identifier, casing preserved) and case-folded on `email`, and an email
  authorizes only when `email_verified` is strictly the JSON `true`: an
  unverified address is a value the person at the IdP typed, not a fact about
  them.
- **The identity is judged once, at login.** The allow-list is not written into
  the cookie and not stored anywhere else; the session proves that a check
  passed, not who passed it, and carries no `sub`, no email, and nothing an
  extension or a session file could read.
- **The client secret joins the host credentials that never leave the
  server.** `PI_WEB_OIDC_CLIENT_SECRET` is stripped from the agent's bash tool,
  from the built-in terminal, and refused in `mcp.json`, exactly like
  `PI_WEB_PASSWORD` (ADR 0001). The list lives in `lib/host-credentials.ts`,
  and the refusal reason that covers both is `denied-host-variable`, naming
  whichever credential an entry reads. Stripping alone would not be enough for
  MCP: the SDK resolves an HTTP entry's headers and `oauth.clientSecret`
  against the whole `process.env` of the connecting process, so a header could
  post the secret to that entry's URL.
- **Configuration is environment only.** No Settings panel, no new config file,
  no new extension API field: OIDC follows the `PI_WEB_*` convention the rest of
  the deployment surface already uses.

## Consequences

- **Revoking someone at the IdP does not end their existing Pi Web session.**
  It lives until it expires or they log out; revocation stops them starting a
  new one. This is deliberate, and it is the cost of not adding single logout,
  back-channel logout, or a session store. It is stated in the README rather
  than left to be discovered.
- **OIDC can never be the only credential.** A deployment that wants SSO and
  no shared password still needs `PI_WEB_PASSWORD` set, because it is a signing
  key, not a second login method. Splitting those two roles means key storage
  and rotation that Pi Web does not have today, which is a separate decision.
- **Pi Web restarts drop in-flight logins.** `state`, `nonce` and the PKCE
  verifier live in a bounded in-process map keyed by a short-lived cookie,
  matching what the provider OAuth routes already do. Sessions already issued
  are unaffected. A stateless alternative would have needed an encrypted cookie
  format of our own, which is the "new session shape" this decision exists to
  avoid.
- **A cross-site top-level navigation must reach the callback**, so
  `lib/request-security.ts` carries one narrow exemption for that exact path,
  shaped like the existing user-navigation exemption, with the Host allow-list
  still running first. CSRF on that path rests on `state` and PKCE. Both the
  start and callback routes stay inside `proxy.ts`'s matcher so the Host
  check covers them: that matters more than the two lines an exemption would
  have saved.
- **One issuer, no roles.** No IdP picker, no group or claim mapping, no
  per-user cwd or tool preset, no dynamic client registration, no refresh
  tokens. The allow-list answers "may this person in", and nothing else.
