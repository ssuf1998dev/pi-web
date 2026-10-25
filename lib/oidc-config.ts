import { isWebPasswordEnabled } from "./web-auth";

/**
 * `PI_WEB_OIDC_*` configuration and the allow-list that decides who may sign in
 * through the operator's identity provider.
 *
 * OIDC is a second door on the login page, never a replacement for the
 * password: a signed-in identity still leaves this server as the very same
 * session cookie the password form mints, so `lib/web-auth.ts` stays the only
 * place a session is judged. That is why an enabled configuration requires
 * `PI_WEB_PASSWORD` — it is the cookie's HMAC key, not just a fallback door.
 *
 * Server-only. The client sees nothing but an `oidc` boolean on
 * `GET /api/web-auth`; the client secret must never reach a browser bundle.
 */

export const OIDC_ISSUER_VARIABLE = "PI_WEB_OIDC_ISSUER";
export const OIDC_CLIENT_ID_VARIABLE = "PI_WEB_OIDC_CLIENT_ID";
export const OIDC_CLIENT_SECRET_VARIABLE = "PI_WEB_OIDC_CLIENT_SECRET";
export const OIDC_ALLOWED_SUBJECTS_VARIABLE = "PI_WEB_OIDC_ALLOWED_SUBJECTS";
export const OIDC_ALLOWED_EMAILS_VARIABLE = "PI_WEB_OIDC_ALLOWED_EMAILS";
export const OIDC_SCOPES_VARIABLE = "PI_WEB_OIDC_SCOPES";

/** `openid` is what makes the flow OpenID Connect; the rest are conveniences. */
const DEFAULT_SCOPES = ["openid", "profile", "email"];

/**
 * Why a configured-looking OIDC setup was not enabled. Named so a route can
 * log it: it names environment variables only, never their values.
 */
export type OidcDisableReason = "password" | "issuer" | "clientId" | "allowList";

export interface OidcAllowList {
  /** `sub` values, compared exactly: a subject is an identifier, not text. */
  subjects: string[];
  /** Email addresses, lower-cased, matched only against a verified claim. */
  emails: string[];
}

export interface OidcConfig {
  /** Trailing slashes stripped: the client compares issuers href to href. */
  issuer: string;
  clientId: string;
  /** Absent for a public client, which then relies on PKCE alone. */
  clientSecret?: string;
  /** `openid` first, then the rest in the order the operator listed them. */
  scopes: string[];
  allowList: OidcAllowList;
}

/** A non-empty list of comma-separated values, blanks and padding dropped. */
function listFromEnvironment(value: string | undefined): string[] {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}

/**
 * Scopes are space-separated in the protocol and comma-separated by this repo's
 * environment-variable convention (`PI_WEB_ALLOWED_HOSTS`), so both are read.
 * Subjects and emails stay comma-only: a subject may legally contain a space.
 */
export function normalizeScopes(value: string | undefined): string[] {
  const scopes = (value ?? DEFAULT_SCOPES.join(" "))
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  // `openid` is what makes this OpenID Connect; the client would refuse a
  // response it cannot turn into an identity, so it is always asked for.
  return ["openid", ...scopes.filter((scope) => scope !== "openid")];
}

/**
 * Keycloak, Entra and the like publish an issuer without a trailing slash, and
 * the client's comparison is exact, so `https://idp/` in a unit file would fail
 * every login with an error the operator cannot act on.
 */
export function normalizeIssuer(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function firstNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function allowListOf(env: NodeJS.ProcessEnv): OidcAllowList {
  return {
    subjects: listFromEnvironment(env[OIDC_ALLOWED_SUBJECTS_VARIABLE]),
    emails: listFromEnvironment(env[OIDC_ALLOWED_EMAILS_VARIABLE])
      .map((email) => email.toLowerCase()),
  };
}

/** The reason OIDC is off, or undefined when every requirement is met. */
export function oidcDisableReason(
  env: NodeJS.ProcessEnv = process.env,
): OidcDisableReason | undefined {
  if (!isWebPasswordEnabled(env.PI_WEB_PASSWORD)) return "password";
  if (!firstNonEmpty(env[OIDC_ISSUER_VARIABLE])) return "issuer";
  if (!firstNonEmpty(env[OIDC_CLIENT_ID_VARIABLE])) return "clientId";
  // An empty allow-list would trade "knows the shared password" for "holds any
  // account at the identity provider". On a server whose agent runs arbitrary
  // commands that is a widening, so an unset list is read as "not configured"
  // rather than "everyone".
  const allowList = allowListOf(env);
  if (allowList.subjects.length === 0 && allowList.emails.length === 0) return "allowList";
  return undefined;
}

/** The parsed configuration, or undefined when OIDC is not enabled. */
export function oidcConfigFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): OidcConfig | undefined {
  if (oidcDisableReason(env) !== undefined) return undefined;

  const clientSecret = firstNonEmpty(env[OIDC_CLIENT_SECRET_VARIABLE]);
  const config: OidcConfig = {
    issuer: normalizeIssuer(env[OIDC_ISSUER_VARIABLE] ?? ""),
    clientId: firstNonEmpty(env[OIDC_CLIENT_ID_VARIABLE]) ?? "",
    scopes: normalizeScopes(env[OIDC_SCOPES_VARIABLE]),
    allowList: allowListOf(env),
  };
  // Deliberately absent rather than undefined-valued, so a spread of this
  // object into a client construction cannot write the secret back in.
  if (clientSecret !== undefined) config.clientSecret = clientSecret;
  return config;
}

/** The three id_token claims the allow-list reads; the client has verified them. */
export interface OidcIdentityClaims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

export function isIdentityAllowed(
  claims: OidcIdentityClaims,
  allowList: OidcAllowList,
): boolean {
  if (typeof claims.sub === "string" && allowList.subjects.includes(claims.sub)) return true;
  // An unverified email is a value the person at the IdP typed, not a fact
  // about them, so it authorizes nothing. Only the JSON boolean `true` counts;
  // a string "true" is not that claim.
  if (claims.email_verified !== true) return false;
  return typeof claims.email === "string"
    && allowList.emails.includes(claims.email.toLowerCase());
}
