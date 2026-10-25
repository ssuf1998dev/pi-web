import { DENIED_HOST_VARIABLES, isDeniedHostVariableName } from "./host-credentials";
import type { McpConfigFieldRef, McpDeniedVariableFieldRef } from "./api-types";

// Which values of an `mcp.json` entry pi resolves before it connects, and the
// denied-host-credential rule over them. Client-safe, with no runtime imports
// but the pure credential list: the add pane (`components/mcp-add-helpers.ts`)
// previews and pre-blocks with the same walk the server-side reader, the
// transport and the routes use (re-exported by `lib/mcp-transport.ts`), so a
// change to which fields pi resolves is made once.

export { DENIED_HOST_VARIABLES, isDeniedHostVariableName };

export interface McpResolvedConfigValue extends McpConfigFieldRef {
  value: string;
}

/** The SDK's value parsers `findDeniedHostVariableField()` needs; the browser passes its port of them. */
export interface McpConfigValueParsers {
  isCommandConfigValue(value: string): boolean;
  getConfigValueEnvVarNames(value: string): string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringEntries(value: unknown): [string, string][] {
  return isRecord(value)
    ? Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    : [];
}

/**
 * The values pi resolves in this process before it connects: `${NAME}`,
 * `$NAME`, `!command`. The SDK's transport resolves a stdio entry's `env`, and
 * an HTTP entry's headers and `oauth.clientSecret`, telling them apart by
 * whether `url` is present. Anything else is used as written. Accepts an
 * entry the SDK has not validated: values that are not strings are skipped.
 */
export function resolvedConfigValues(config: unknown): McpResolvedConfigValue[] {
  if (!isRecord(config)) return [];
  if (!("url" in config)) {
    return stringEntries(config.env).map(([name, value]) => ({ kind: "env", name, value }));
  }
  const values: McpResolvedConfigValue[] = stringEntries(config.headers).map(([name, value]) => ({
    kind: "header",
    name,
    value,
  }));
  const clientSecret = isRecord(config.oauth) ? config.oauth.clientSecret : undefined;
  if (typeof clientSecret === "string") values.push({ kind: "oauth-client-secret", value: clientSecret });
  return values;
}

/** A value of `config` that reads a denied host credential, and which one. */
export type DeniedHostVariableFieldRef = McpDeniedVariableFieldRef;

/**
 * The value of `config` that references one of `DENIED_HOST_VARIABLES`, with
 * that variable's name, or undefined. Values resolve against this process's
 * environment, which still holds the credential, so removing it from the
 * server's environment is not enough. Names compare case-insensitively, as
 * Windows resolves them. A `!command` can read the variable without a `$`
 * reference, so any mention counts; the SDK still runs it with this process's
 * whole environment.
 */
export function findDeniedHostVariableField(
  config: unknown,
  parsers: McpConfigValueParsers,
): DeniedHostVariableFieldRef | undefined {
  for (const { value, ...field } of resolvedConfigValues(config)) {
    const upper = value.toUpperCase();
    const names = parsers.isCommandConfigValue(value) ? null : parsers.getConfigValueEnvVarNames(value);
    const variable = DENIED_HOST_VARIABLES.find((name) => (
      names === null ? upper.includes(name) : names.some((ref) => ref.toUpperCase() === name)
    ));
    if (variable !== undefined) return { ...field, variable };
  }
  return undefined;
}
