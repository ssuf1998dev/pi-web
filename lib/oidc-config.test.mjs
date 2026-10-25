import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const oidc = await jiti.import("./oidc-config.ts");

/** A complete, enabled environment; callers override or delete what they test. */
function environment(overrides = {}) {
  const env = {
    PI_WEB_PASSWORD: "correct horse battery staple",
    PI_WEB_OIDC_ISSUER: "https://idp.example/realms/pi",
    PI_WEB_OIDC_CLIENT_ID: "pi-web",
    PI_WEB_OIDC_ALLOWED_SUBJECTS: "user-1",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

test("enables OIDC only when the password, issuer, client id and a non-empty allow-list are all present", () => {
  assert.notEqual(oidc.oidcConfigFromEnvironment(environment()), undefined);

  // Each missing requirement names its own reason, so a log tells the operator
  // which variable to set.
  assert.equal(oidc.oidcDisableReason(environment({ PI_WEB_PASSWORD: undefined })), "password");
  assert.equal(oidc.oidcDisableReason(environment({ PI_WEB_PASSWORD: "" })), "password");
  assert.equal(oidc.oidcDisableReason(environment({ PI_WEB_OIDC_ISSUER: undefined })), "issuer");
  assert.equal(oidc.oidcDisableReason(environment({ PI_WEB_OIDC_ISSUER: "   " })), "issuer");
  assert.equal(oidc.oidcDisableReason(environment({ PI_WEB_OIDC_CLIENT_ID: undefined })), "clientId");
  assert.equal(oidc.oidcDisableReason(environment({ PI_WEB_OIDC_ALLOWED_SUBJECTS: undefined })), "allowList");
  assert.equal(oidc.oidcDisableReason(environment()), undefined);
});

test("an empty allow-list does not enable OIDC, even with every other value set", () => {
  // The whole point: configuring an issuer must not widen the door to every
  // account at that identity provider.
  const env = environment({
    PI_WEB_OIDC_ALLOWED_SUBJECTS: undefined,
    PI_WEB_OIDC_ALLOWED_EMAILS: undefined,
    PI_WEB_OIDC_CLIENT_SECRET: "a-secret",
    PI_WEB_OIDC_SCOPES: "openid email",
  });
  assert.equal(oidc.oidcDisableReason(env), "allowList");
  assert.equal(oidc.oidcConfigFromEnvironment(env), undefined);

  // Whitespace and empty items are not entries.
  for (const filler of ["", "   ", ",", " , , ", ",,"]) {
    const padded = environment({
      PI_WEB_OIDC_ALLOWED_SUBJECTS: filler,
      PI_WEB_OIDC_ALLOWED_EMAILS: filler,
    });
    assert.equal(oidc.oidcConfigFromEnvironment(padded), undefined, JSON.stringify(filler));
  }
});

test("reads every value from the environment", () => {
  const config = oidc.oidcConfigFromEnvironment(environment({
    PI_WEB_OIDC_ISSUER: "https://sso.corp.example/realms/main",
    PI_WEB_OIDC_CLIENT_ID: "  pi-web  ",
    PI_WEB_OIDC_CLIENT_SECRET: "s3cr3t",
    PI_WEB_OIDC_ALLOWED_SUBJECTS: "user-1, user-2 ,user-3",
    PI_WEB_OIDC_ALLOWED_EMAILS: "Ada@Corp.example, bob@corp.example ,",
  }));

  assert.equal(config.issuer, "https://sso.corp.example/realms/main");
  assert.equal(config.clientId, "pi-web");
  assert.equal(config.clientSecret, "s3cr3t");
  assert.deepEqual(config.allowList.subjects, ["user-1", "user-2", "user-3"]);
  assert.deepEqual(config.allowList.emails, ["ada@corp.example", "bob@corp.example"]);
});

test("a public client keeps its secret absent rather than present-and-undefined", () => {
  const config = oidc.oidcConfigFromEnvironment(environment());
  assert.equal("clientSecret" in config, false);

  // Blanks count as unset: a unit file with an empty value is a public client,
  // and the client must not be built with an empty-string secret.
  for (const blank of ["", "   "]) {
    const blankConfig = oidc.oidcConfigFromEnvironment(
      environment({ PI_WEB_OIDC_CLIENT_SECRET: blank }),
    );
    assert.equal("clientSecret" in blankConfig, false, JSON.stringify(blank));
  }
});

test("an issuer's trailing slashes are stripped because the client compares href to href", () => {
  for (const suffix of ["/", "//", "///"]) {
    assert.equal(
      oidc.oidcConfigFromEnvironment(environment({
        PI_WEB_OIDC_ISSUER: `https://idp.example/realms/pi${suffix}`,
      })).issuer,
      "https://idp.example/realms/pi",
    );
  }
  // A bare host keeps its origin and gains no path.
  assert.equal(oidc.normalizeIssuer("https://idp.example/"), "https://idp.example");
  assert.equal(oidc.normalizeIssuer("  https://idp.example  "), "https://idp.example");
});

test("scopes always ask for openid, exactly once, and keep the operator's order", () => {
  assert.deepEqual(oidc.normalizeScopes(undefined), ["openid", "profile", "email"]);
  assert.deepEqual(oidc.normalizeScopes("openid profile email"), ["openid", "profile", "email"]);
  // A list without openid is still OpenID Connect.
  assert.deepEqual(oidc.normalizeScopes("profile email"), ["openid", "profile", "email"]);
  // openid listed twice, or with odd spacing, is declared once and first.
  assert.deepEqual(oidc.normalizeScopes("email openid , profile"), ["openid", "email", "profile"]);
  assert.deepEqual(oidc.normalizeScopes("offline_access"), ["openid", "offline_access"]);
  assert.deepEqual(oidc.normalizeScopes(""), ["openid"]);
});

test("subjects are matched exactly, since a subject is an identifier", () => {
  const allowList = oidc.oidcConfigFromEnvironment(environment({
    PI_WEB_OIDC_ALLOWED_SUBJECTS: "User-1",
  })).allowList;

  assert.equal(oidc.isIdentityAllowed({ sub: "User-1" }, allowList), true);
  assert.equal(oidc.isIdentityAllowed({ sub: "user-1" }, allowList), false);
  assert.equal(oidc.isIdentityAllowed({ sub: "USER-1" }, allowList), false);
});

test("emails are matched case-insensitively, but only when the claim says verified", () => {
  const allowList = oidc.oidcConfigFromEnvironment(environment({
    PI_WEB_OIDC_ALLOWED_SUBJECTS: undefined,
    PI_WEB_OIDC_ALLOWED_EMAILS: "Ada@Corp.example",
  })).allowList;

  assert.equal(
    oidc.isIdentityAllowed({ sub: "x", email: "ada@corp.example", email_verified: true }, allowList),
    true,
  );
  assert.equal(
    oidc.isIdentityAllowed({ sub: "x", email: "ADA@CORP.EXAMPLE", email_verified: true }, allowList),
    true,
  );

  // An unverified email is what the person at the IdP typed, not a fact.
  for (const notVerified of [false, undefined, "true", 1, null, ""]) {
    assert.equal(
      oidc.isIdentityAllowed({ sub: "x", email: "ada@corp.example", email_verified: notVerified }, allowList),
      false,
      JSON.stringify(notVerified),
    );
  }
});

function sourceFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (/\.(tsx|jsx|ts|js)$/.test(entry.name)) found.push(path);
  }
  return found;
}

test("no client code reaches the OIDC configuration or its secret", () => {
  const root = process.cwd();
  const clientDirs = [join(root, "components"), join(root, "hooks"), join(root, "app")];
  const importsOidcConfig = /from\s+["'][^"']*lib\/oidc-config["']/;

  // Routes under app/api run on the server; everything the browser loads must
  // stay clear of the module.
  const offenders = clientDirs
    .flatMap((dir) => sourceFiles(dir))
    .filter((path) => !path.includes(`${sep}app${sep}api${sep}`))
    .filter((path) => importsOidcConfig.test(readFileSync(path, "utf8")));

  assert.deepEqual(offenders, []);
});

test("a subject hit does not need a verified email, and a stranger gets nothing", () => {
  const allowList = oidc.oidcConfigFromEnvironment(environment({
    PI_WEB_OIDC_ALLOWED_SUBJECTS: "user-1",
    PI_WEB_OIDC_ALLOWED_EMAILS: "ada@corp.example",
  })).allowList;

  assert.equal(oidc.isIdentityAllowed({ sub: "user-1" }, allowList), true);
  assert.equal(oidc.isIdentityAllowed({ sub: "intruder" }, allowList), false);
  assert.equal(oidc.isIdentityAllowed({}, allowList), false);
  assert.equal(oidc.isIdentityAllowed({ sub: 42, email: 42 }, allowList), false);
});

test("a non-empty subject list alone authorizes, and so does an email list alone", () => {
  const subjectsOnly = oidc.oidcConfigFromEnvironment(environment({
    PI_WEB_OIDC_ALLOWED_EMAILS: undefined,
  }));
  assert.deepEqual(subjectsOnly.allowList.emails, []);
  assert.equal(oidc.isIdentityAllowed({ sub: "user-1" }, subjectsOnly.allowList), true);

  const emailsOnly = oidc.oidcConfigFromEnvironment(environment({
    PI_WEB_OIDC_ALLOWED_SUBJECTS: undefined,
    PI_WEB_OIDC_ALLOWED_EMAILS: "ada@corp.example",
  }));
  assert.deepEqual(emailsOnly.allowList.subjects, []);
  assert.equal(
    oidc.isIdentityAllowed({ email: "ada@corp.example", email_verified: true }, emailsOnly.allowList),
    true,
  );
});
