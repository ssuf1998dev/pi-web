/**
 * The credentials of the Pi Web host itself — the variables that guard or
 * configure this server rather than any project it runs.
 *
 * They are stripped from the environment of the shells and servers Pi Web
 * starts (ADR 0001, extended by ADR 0007 for the OIDC client secret), and an
 * `mcp.json` entry that reads one is refused outright: the SDK resolves an
 * HTTP entry's headers and `oauth.clientSecret` against the whole
 * `process.env` of the connecting process, so stripping them from a stdio
 * child's environment would not stop a header from sending one to that
 * entry's URL.
 *
 * Names only, never values, and no runtime imports: the browser's add pane
 * pre-blocks with this same list.
 */
export const DENIED_HOST_VARIABLES = ["PI_WEB_PASSWORD", "PI_WEB_OIDC_CLIENT_SECRET"] as const;

/** Whether `name` names one of them, in any casing, as Windows resolves names. */
export function isDeniedHostVariableName(name: string): boolean {
  const upper = name.toUpperCase();
  return DENIED_HOST_VARIABLES.some((variable) => variable === upper);
}
