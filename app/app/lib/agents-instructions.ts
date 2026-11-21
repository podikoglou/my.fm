/** The remote MCP endpoint sits on the same origin as the page that shows it. */
const MCP_PATH = "/mcp";

/**
 * The prompt a signed-in user pastes into an agent to register the MCP server.
 * The endpoint comes from the page's origin, because the access token is issued
 * for the origin that served the consent screen.
 */
export function agentOnboardingInstructions(origin: string) {
  const endpoint = new URL(MCP_PATH, origin).href;

  return [
    "Add the my.fm MCP server to this agent.",
    "",
    `URL: ${endpoint}`,
    "Transport: streamable HTTP",
    "Auth: OAuth 2.1. Your client opens a browser window: sign in to my.fm and press Allow.",
    "Access is read-only.",
    "",
    "Claude Code:",
    `claude mcp add --transport http my.fm ${endpoint}`,
    "",
    "OpenCode:",
    `opencode mcp add my.fm --url ${endpoint}`,
  ].join("\n");
}
