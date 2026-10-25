import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const values = await jiti.import("./mcp-config-values.ts");
const transport = await jiti.import("./mcp-transport.ts");
const { configValueEnvVarNames, isCommandConfigValue } = await jiti.import("./mcp-import.ts");
const { loadPiSdkInternals } = await jiti.import("./pi-sdk-internals.ts");

const internals = await loadPiSdkInternals();
assert.equal(internals.ok, true, internals.reason);

test("the server uses the very same value walk and denied-host-credential rule", () => {
  assert.equal(transport.resolvedConfigValues, values.resolvedConfigValues);
  assert.equal(transport.findDeniedHostVariableField, values.findDeniedHostVariableField);
  assert.deepEqual(values.DENIED_HOST_VARIABLES, ["PI_WEB_PASSWORD", "PI_WEB_OIDC_CLIENT_SECRET"]);
});

test("the browser's parsers find a denied host variable where the SDK's do", () => {
  const browser = { isCommandConfigValue, getConfigValueEnvVarNames: configValueEnvVarNames };
  for (const config of [
    { command: "x", env: { A: "${PI_WEB_PASSWORD}" } },
    { command: "x", env: { A: "$pi_web_password" } },
    { command: "x", env: { A: "$$PI_WEB_PASSWORD" } },
    { command: "x", env: { A: "!echo $PI_WEB_PASSWORD" } },
    { url: "https://x.example/mcp", headers: { Authorization: "Bearer ${PI_WEB_PASSWORD}" } },
    { url: "https://x.example/mcp", oauth: { clientSecret: "${PI_WEB_PASSWORD}" } },
    { url: "https://x.example/mcp", env: { A: "${PI_WEB_PASSWORD}" } },
    { command: "x", headers: { A: "${PI_WEB_PASSWORD}" } },
    // The OIDC client secret is the same class of credential (ADR 0007).
    { command: "x", env: { A: "${PI_WEB_OIDC_CLIENT_SECRET}" } },
    { command: "x", env: { A: "$pi_web_oidc_client_secret" } },
    { command: "x", env: { A: "!printenv PI_WEB_OIDC_CLIENT_SECRET" } },
    { url: "https://x.example/mcp", headers: { Authorization: "Bearer ${PI_WEB_OIDC_CLIENT_SECRET}" } },
    { url: "https://x.example/mcp", oauth: { clientSecret: "$PI_WEB_OIDC_CLIENT_SECRET" } },
  ]) {
    assert.deepEqual(values.findDeniedHostVariableField(config, browser), values.findDeniedHostVariableField(config, internals), JSON.stringify(config));
  }
});

test("the refusal names the credential it hit, whichever of the two it was", () => {
  const browser = { isCommandConfigValue, getConfigValueEnvVarNames: configValueEnvVarNames };
  assert.deepEqual(values.findDeniedHostVariableField({ command: "x", env: { TOKEN: "${pi_web_oidc_client_secret}" } }, browser), {
    kind: "env",
    name: "TOKEN",
    variable: "PI_WEB_OIDC_CLIENT_SECRET",
  });
  // Values are walked in the entry's own order, so the first one reading a
  // denied credential is the one named.
  assert.equal(
    values.findDeniedHostVariableField(
      { url: "https://x.example/mcp", headers: { A: "${PI_WEB_OIDC_CLIENT_SECRET}", B: "${PI_WEB_PASSWORD}" } },
      browser,
    ).variable,
    "PI_WEB_OIDC_CLIENT_SECRET",
  );
  assert.equal(
    values.findDeniedHostVariableField(
      { url: "https://x.example/mcp", headers: { A: "${PI_WEB_PASSWORD}", B: "${PI_WEB_OIDC_CLIENT_SECRET}" } },
      browser,
    ).variable,
    "PI_WEB_PASSWORD",
  );
});

test("a name that only looks like a denied credential is left alone", () => {
  const browser = { isCommandConfigValue, getConfigValueEnvVarNames: configValueEnvVarNames };
  for (const value of ["$${PI_WEB_PASSWORD}", "${PI_WEB_PASSWORD_HINT}", "${PI_WEB_OIDC_CLIENT_ID}", "${OIDC_CLIENT_SECRET}", "literal PI_WEB_OIDC_CLIENT_SECRET"]) {
    assert.equal(values.findDeniedHostVariableField({ url: "https://x.example/mcp", headers: { A: value } }, browser), undefined, value);
  }
});

test("isDeniedHostVariableName matches a credential name in any casing", () => {
  assert.equal(values.isDeniedHostVariableName("PI_WEB_PASSWORD"), true);
  assert.equal(values.isDeniedHostVariableName("pi_web_oidc_client_secret"), true);
  assert.equal(values.isDeniedHostVariableName("PI_WEB_OIDC_CLIENT_ID"), false);
  assert.equal(values.isDeniedHostVariableName("PI_WEB_OIDC_ISSUER"), false);
  assert.equal(values.isDeniedHostVariableName("PATH"), false);
});
