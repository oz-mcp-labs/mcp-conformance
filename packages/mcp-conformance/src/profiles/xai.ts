/**
 * xAI / Grok MCP clients.
 *
 * This is the best-evidenced profile in the registry, because it is the one
 * client whose real connect sequence has actually been captured. The four-line
 * HTTP trace in `docs/evidence/grok-connector.md` section 5 - recovered from Vercel
 * production runtime logs on 2026-08-17 - is the strongest evidence in the whole
 * package, and it establishes two facts no vendor document states: Grok runs MCP
 * OAuth discovery, and it will not follow a cross-origin redirect for
 * authorization-server metadata.
 *
 * Two surfaces, genuinely different clients:
 * - `grok-connector` - grok.com custom connectors and the cloud console. The MCP
 *   client runs on xAI's backend; the browser only drives a connector-management
 *   RPC service.
 * - `xai-api-remote-mcp` - the API `{"type":"mcp",...}` tool. Static credential
 *   only, no OAuth. Note the contrast with OpenAI: `require_approval` and
 *   `connector_id` are documented as not supported by xAI, even though the
 *   OpenAPI schema accepts the fields.
 */

import type { Citation, ClientProfile } from '../types.ts'

const RETRIEVED = '2026-08-28'

const OBSERVED_TRACE: Citation = {
  kind: 'observed',
  ref: 'docs/evidence/grok-connector.md section 5',
  retrieved: '2026-08-17',
  note: 'Vercel production runtime logs, 23:47:05-07Z: GET /mcp -> 401 + WWW-Authenticate; GET /.well-known/oauth-protected-resource -> 200; GET /.well-known/oauth-authorization-server -> 308 to a different-origin authorization server, NOT followed; GET /.well-known/oauth-authorization-server/mcp -> 404. Discovery dead-ended there.',
}

const OBSERVED_ECHO_FIX: Citation = {
  kind: 'observed',
  ref: 'docs/evidence/grok-connector.md sections 2 and 6',
  retrieved: '2026-08-18',
  note: 'Every hand-rolled surface answered initialize with its own PROTOCOL_VERSION regardless of the request. Echoing the requested revision (#102) and serving discovery 200s (#103) are recorded as the two necessary server fixes before Grok attached.',
}

const OBSERVED_NOTIFICATION_FIX: Citation = {
  kind: 'observed',
  ref: 'docs/evidence/grok-connector.md section 2',
  retrieved: '2026-08-18',
  note: 'The same surfaces answered id-less notifications/* with a JSON-RPC response instead of 202 Accepted and an empty body. Fixed alongside the negotiation change.',
}

const XAI_REMOTE_MCP: Citation = {
  kind: 'doc',
  url: 'https://docs.x.ai/developers/tools/remote-mcp',
  retrieved: RETRIEVED,
  note: 'server_url and server_label required; server_description, allowed_tools, authorization, headers optional. Only Streaming HTTP and SSE transports are supported. The require_approval and connector_id parameters in the OpenAI Responses API are not currently supported.',
}

const XAI_TUNNELING: Citation = {
  kind: 'doc',
  url: 'https://docs.x.ai/grok/connectors/custom-mcp-tunneling',
  retrieved: RETRIEVED,
  note: 'Servers on localhost or a private network address (127.0.0.1, 10.x.x.x, 172.16.x.x, 192.168.x.x) are rejected. Cloudflare quick tunnels do not support SSE; servers using Streamable HTTP work fine with Cloudflare. If your MCP server requires OAuth or API keys, you will still complete that flow in Grok.',
}

const GROK_BUNDLE_OAUTH: Citation = {
  kind: 'observed',
  ref: 'grok.com production bundle, connector service protobuf descriptor',
  retrieved: RETRIEVED,
  note: 'ValidateMcpServerUrl returns is_valid, auth_required, oauth_strategy, and discovered_oauth_metadata whose fields are issuer, authorization_endpoint, token_endpoint, registration_endpoint, scopes_supported, grant_types_supported, response_types_supported, code_challenge_methods_supported. Strategy enum UNKNOWN=0, NONE=1, DCR=2, CIMD=3, BYO=4.',
}

const GROK_BUNDLE_UI: Citation = {
  kind: 'observed',
  ref: 'grok.com production bundle, MCP Apps host',
  retrieved: RETRIEVED,
  note: 'Reads _meta.ui.resourceUri, falling back to _meta["ui/resourceUri"] and _meta["openai/outputTemplate"]; the value must start with ui:// or it throws. resources/read must return exactly one content item. Media type text/html;profile=mcp-app. Host identity { name: "grok-web", version: "1.0.0" }.',
}

const OBSERVED_DCR: Citation = {
  kind: 'observed',
  ref: 'docs/evidence/grok-connector.md section 5',
  retrieved: '2026-08-17',
  note: 'POST /oauth/register on the authorization server with a https://grok.com/... redirect URI returns 201 with a client_id. The leg after discovery is verified working.',
}

const OBSERVED_VIRTUAL_AS: Citation = {
  kind: 'observed',
  ref: 'docs/evidence/grok-connector.md section 8',
  retrieved: '2026-09-01',
  note: 'Grok treated the MCP resource origin as the authorization server and would not cross to the backing authorization service for metadata or authorize. The working shape advertises the resource origin, serves a matching issuer and same-origin OAuth endpoints, and reverse-proxies authorize instead of redirecting it.',
}

export const grokConnectorProfile: ClientProfile = {
  id: 'grok-connector',
  displayName: 'Grok custom connector (grok.com)',
  vendor: 'xAI',
  summary:
    'A custom connector added at grok.com/connectors or from the cloud console. The MCP client and the whole OAuth dance run on xAI backend infrastructure, so CORS never applies. It runs RFC 9728 discovery from the WWW-Authenticate challenge, treats the MCP resource origin as a virtual authorization server, and refuses cross-origin hops for metadata or authorize. grok.com is also an MCP Apps host.',
  acceptedProtocolRevisions: [],
  supportsModernEra: false,
  transports: ['streamable-http', 'http-sse-pair'],
  authStrategies: ['oauth-cimd', 'oauth-dcr', 'oauth-manual-client', 'static-bearer', 'custom-headers', 'none'],
  discoverySequence: [
    {
      method: 'GET',
      path: '<mcp endpoint>',
      note: 'Expects 401 with a WWW-Authenticate challenge pointing at the protected resource metadata. A URL that 404s with no challenge yields oauthStrategy NONE and discovery never starts.',
      sources: [OBSERVED_TRACE],
      confidence: 'observed',
    },
    {
      method: 'GET',
      path: '/.well-known/oauth-protected-resource',
      note: 'Answered 200 in the captured trace.',
      sources: [OBSERVED_TRACE],
      confidence: 'observed',
    },
    {
      method: 'GET',
      path: '/.well-known/oauth-authorization-server',
      note: 'Must be 200 on the resource origin. The captured 308 to a different-origin authorization server was not followed.',
      sources: [OBSERVED_TRACE],
      confidence: 'observed',
    },
    {
      method: 'GET',
      path: '/.well-known/oauth-authorization-server/<mcp path>',
      note: 'The fallback after refusing the cross-origin redirect. It 404d, and discovery dead-ended.',
      sources: [OBSERVED_TRACE],
      confidence: 'observed',
    },
    {
      method: 'HEAD',
      path: '<resource origin>/oauth/authorize',
      note: 'The authorization endpoint must stay on the virtual authorization-server origin; a cross-origin redirect back to the backing authorization service is rejected before the OAuth popup can complete.',
      sources: [OBSERVED_VIRTUAL_AS],
      confidence: 'observed',
    },
    {
      method: 'POST',
      path: '<registration_endpoint>',
      note: 'Dynamic client registration with a https://grok.com/... redirect URI; verified to return 201 with a client_id.',
      sources: [OBSERVED_DCR, GROK_BUNDLE_OAUTH],
      confidence: 'observed',
    },
  ],
  requirements: [
    {
      check: 'initialize-version-echo',
      confidence: 'observed',
      rationale:
        'Answering initialize with the server own newer revision instead of echoing the requested one is recorded as one of the two necessary fixes before Grok would attach. The requirement is observed even though the specific revision Grok requests is not yet known.',
      sources: [OBSERVED_ECHO_FIX],
      params: { revisions: ['2025-03-26', '2025-06-18', '2025-11-25'] },
    },
    {
      check: 'notification-ack-202',
      confidence: 'observed',
      rationale: 'Fixed in the same pass as the negotiation bug, for the same connector.',
      sources: [OBSERVED_NOTIFICATION_FIX],
    },
    {
      check: 'unauthenticated-401-challenge',
      confidence: 'observed',
      rationale:
        'The captured trace starts with a 401 plus a challenge. A path that 404s with no challenge produces {"isValid":false,"authRequired":false,"oauthStrategy":"OAUTH_STRATEGY_NONE"} and Grok never begins discovery.',
      sources: [OBSERVED_TRACE, { kind: 'observed', ref: 'docs/evidence/grok-connector.md sections 6 and 7', retrieved: '2026-08-18' }],
    },
    {
      check: 'prm-document-served',
      confidence: 'observed',
      rationale: 'The second request of the captured trace, answered 200.',
      sources: [OBSERVED_TRACE],
    },
    {
      check: 'as-metadata-both-paths',
      confidence: 'observed',
      rationale:
        'Both the origin-root and the path-suffixed form must answer 200 on the resource origin. The path-suffixed 404 is precisely where the first real connect attempt died.',
      sources: [OBSERVED_TRACE],
    },
    {
      check: 'as-metadata-no-cross-origin-redirect',
      confidence: 'observed',
      rationale:
        'Grok was watched refusing to follow a 308 to a different-origin authorization server. This is the single most expensive fact in the registry: three sessions debugged the server before it was found.',
      sources: [OBSERVED_TRACE],
    },
    {
      check: 'as-metadata-origin-consistent',
      confidence: 'observed',
      rationale:
        'Serving metadata on the resource origin is insufficient when it still names another origin as issuer or publishes cross-origin endpoints. Grok treats the resource origin itself as the authorization server.',
      sources: [OBSERVED_VIRTUAL_AS],
    },
    {
      check: 'authorization-endpoint-same-origin',
      confidence: 'observed',
      rationale:
        'Grok would not carry the handshake across a redirect from the advertised resource-origin authorization endpoint to the backing authorization service, so authorize must be reverse-proxied on origin.',
      sources: [OBSERVED_VIRTUAL_AS],
    },
    {
      check: 'as-metadata-pkce-s256',
      confidence: 'observed',
      rationale:
        'The connector service parses code_challenge_methods_supported out of the discovered metadata, so the field must be present and should advertise S256. Parsing is observed; enforcement is not, which is recorded as an unknown.',
      sources: [GROK_BUNDLE_OAUTH],
    },
    {
      check: 'tools-list-shape',
      confidence: 'documented',
      rationale: 'The connector tool surface is discovered from tools/list and stored per tool.',
      sources: [XAI_REMOTE_MCP, GROK_BUNDLE_OAUTH],
    },
    {
      check: 'response-content-type',
      confidence: 'documented',
      rationale:
        'Only Streaming HTTP and SSE transports are supported, and the tunnel guidance confirms a plain JSON answer on the POST is acceptable.',
      sources: [XAI_REMOTE_MCP, XAI_TUNNELING],
    },
    {
      check: 'session-header-absent-or-echoed',
      confidence: 'inferred',
      rationale:
        'Every surface Grok has been watched attaching to is stateless and issues no session id, so a session is evidently not required. Whether Grok would honor one is unknown.',
      sources: [{ kind: 'observed', ref: 'docs/evidence/grok-connector.md sections 3 and 6', retrieved: '2026-08-18' }],
    },
    {
      check: 'mcp-apps-ui-resource-resolvable',
      confidence: 'inferred',
      rationale:
        'grok.com is an MCP Apps host and its renderer resolves UI resources off the generic connector tool-result stream, addressing servers by prefix with no visible built-in-only gate. Not observed against a custom connector, so advisory.',
      sources: [GROK_BUNDLE_UI],
    },
    {
      check: 'mcp-apps-widget-mime-type',
      confidence: 'inferred',
      rationale:
        'The host accepts text/html;profile=mcp-app and, in a second path, any text/html*, rejecting others. Same caveat: not observed against a custom connector.',
      sources: [GROK_BUNDLE_UI],
    },
  ],
  quirks: [
    {
      note: 'Read the connector record before debugging the server. A mistyped serverUrl (/mco instead of /mcp) 404s with no WWW-Authenticate, which Grok reports as {"isValid":false,"authRequired":false,"oauthStrategy":"OAUTH_STRATEGY_NONE"}. Three sessions debugged the server while the failure was in the connector configuration.',
      sources: [{ kind: 'observed', ref: 'docs/evidence/grok-connector.md sections 6 and 7', retrieved: '2026-08-18' }],
      confidence: 'observed',
    },
    {
      note: 'localhost and RFC 1918 addresses are rejected client-side before any network call, with the exact predicate: hostname === "localhost", or an IPv4 dotted quad whose first octet is 10 or 127, or 172 with a second octet 16-31, or 192.168. IPv6 loopback, 169.254.0.0/16, and DNS names resolving to private addresses are not covered by that check.',
      sources: [XAI_TUNNELING, { kind: 'observed', ref: 'grok.com production bundle, LocallyHostedMCPError predicate', retrieved: RETRIEVED }],
      confidence: 'observed',
    },
    {
      note: 'The OAuth popup must complete within 180 seconds and the redirect URI is https://grok.com/connectors-oauth-exchange-code/ (trailing slash), built from window.location.origin - so on the business console it is that origin instead.',
      sources: [{ kind: 'observed', ref: 'grok.com production bundle, OAuthTimeoutError and redirect construction', retrieved: RETRIEVED }],
      confidence: 'observed',
    },
    {
      note: 'Tool names reach the model as <server_label>___<tool_name> with a three-underscore delimiter. The server prefix is read up to the FIRST delimiter and the bare tool name after the LAST, so a tool name containing three consecutive underscores is parsed inconsistently by the two helpers.',
      sources: [{ kind: 'observed', ref: 'grok.com production bundle, MCP_TOOL_NAME_DELIMITER', retrieved: RETRIEVED }],
      confidence: 'observed',
    },
    {
      note: 'The connector configuration carries both allowed_tool_names and blocked_tool_names plus per-connector custom headers, none of which the public documentation mentions.',
      sources: [GROK_BUNDLE_OAUTH],
      confidence: 'observed',
    },
    {
      note: 'CORS is irrelevant on this path: discovery, registration, token exchange, tools/call and resources/read all run from xAI backend infrastructure. The only browser-side legs are grok.com same-origin RPCs, the OAuth popup navigating to your authorization endpoint, and the MCP App iframe, whose outbound requests are governed by _meta.ui.csp rather than by your CORS headers.',
      sources: [GROK_BUNDLE_OAUTH, GROK_BUNDLE_UI, { kind: 'observed', ref: 'docs/evidence/grok-connector.md section 6', retrieved: '2026-08-18' }],
      confidence: 'observed',
    },
  ],
  unknowns: [
    {
      question:
        'What protocolVersion does Grok send on initialize, and does it send MCP-Protocol-Version on later requests?',
      experiment:
        'Deploy an MCP server in public mode that logs the full initialize body and every request header, then add it as a grok.com custom connector. A second connector pointed at a server that always answers 2025-11-25 separates "requires echo" from "tolerant". Needs a Grok account only, no API key.',
      impact:
        'This is the largest single gap in the profile. The echo REQUIREMENT is already observed; only the revision list is guessed. Evidence narrows it to 2025-03-26 or 2025-06-18, with 2025-03-26 the leading candidate because the section 7 audit found Grok following the 2025-03-26 model of treating the resource origin as its authorization server.',
    },
    {
      question:
        'Does Grok refresh an expired access token against the authorization server, or does it require re-authorization?',
      experiment:
        'Connect the URL as a custom connector, wait past the access token\'s expiry, and issue a tool call. Watch the authorization server for a refresh_token grant at /oauth/token. Success means no long-lived credential is needed; failure or a NEEDS_REAUTH state means one must be minted.',
      impact:
        'This is the open gap in docs/evidence/grok-connector.md section 4. The connector service exposes GetValidAccessToken, an InvalidateOAuthToken RPC, a refresh_token flag on the list request, and a NEEDS_REAUTH status - strongly suggesting refresh is implemented server-side - but none of that is confirmation against this authorization server.',
    },
    {
      question: 'Does MCP Apps rendering fire for a custom connector, or only for xAI built-ins?',
      experiment:
        'Hosted server exposing one tool with _meta["ui/resourceUri"] = "ui://demo/panel" and a resources/read returning a single text content with mimeType text/html;profile=mcp-app.',
      impact:
        'If it renders, the two MCP Apps requirements on this profile move from inferred to observed, and a widget surface gains a second host besides Claude.',
    },
    {
      question: 'Is there a tool-count ceiling on either xAI surface?',
      experiment: 'Servers exposing 100 / 130 / 200 tools; count what reaches the model and whether tool_search engages.',
      impact:
        'A third-party guide claims 128 with silent dropping above it. Nothing from xAI states a cap, so no tool-count-limit requirement is carried.',
    },
    {
      question: 'Does xAI prepend "Bearer " to the authorization value, or send it verbatim?',
      experiment:
        'A logging server sent authorization: "wcd_test123" compared against a run sending "Bearer wcd_test123". The xAI documentation is internally inconsistent: the remote-MCP page passes a bare token, the speech-to-speech page passes a Bearer-prefixed one.',
      impact: 'A server should accept both forms until this is settled.',
    },
  ],
  disagreements: [
    {
      topic: 'Whether xAI documents an OAuth flow for custom connectors',
      positions: [
        'docs/evidence/grok-connector.md section 1 (2026-08-17) states the docs describe no OAuth flow.',
        'docs.x.ai/grok/connectors/custom-mcp-tunneling (retrieved 2026-08-28) says an OAuth or API-key flow is completed in Grok after providing the tunnel URL.',
      ],
      resolution:
        'Softened rather than reversed. OAuth is now acknowledged in prose, but no flow, RFC, DCR or PKCE detail is documented anywhere. The observed trace and the connector service schema remain the only real sources, which is why every auth requirement here is carried as observed rather than documented.',
    },
  ],
}

export const xaiApiRemoteMcpProfile: ClientProfile = {
  id: 'xai-api-remote-mcp',
  displayName: 'xAI API remote MCP tool',
  vendor: 'xAI',
  summary:
    'A tool entry of shape {"type":"mcp","server_label":...,"server_url":...} on an xAI API request. No OAuth discovery at all: the caller supplies a token in `authorization` plus arbitrary `headers`. Documented as not supporting require_approval or connector_id, which is the concrete difference from the otherwise similar OpenAI Responses API tool.',
  acceptedProtocolRevisions: [],
  supportsModernEra: false,
  transports: ['streamable-http', 'http-sse-pair'],
  authStrategies: ['static-bearer', 'custom-headers', 'none'],
  discoverySequence: [
    {
      method: 'POST',
      path: '<server_url>',
      note: 'initialize then tools/list with authorization and headers applied as given. No OAuth leg exists in the tool schema.',
      sources: [XAI_REMOTE_MCP],
      confidence: 'documented',
    },
  ],
  requirements: [
    {
      check: 'initialize-version-echo',
      confidence: 'inferred',
      rationale:
        'No revision is documented for this surface, and it is a different backend from the connector - do not assume the two negotiate identically.',
      sources: [XAI_REMOTE_MCP],
      params: { revisions: ['2025-03-26', '2025-06-18', '2025-11-25'] },
    },
    {
      check: 'tools-list-shape',
      confidence: 'documented',
      rationale: 'The tool surface is discovered from tools/list; allowed_tools trims what enters context.',
      sources: [XAI_REMOTE_MCP],
    },
    {
      check: 'notification-ack-202',
      confidence: 'documented',
      rationale: 'Streamable HTTP transport requirement.',
      sources: [
        {
          kind: 'spec',
          url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports',
          retrieved: RETRIEVED,
        },
      ],
    },
    {
      check: 'response-content-type',
      confidence: 'documented',
      rationale: 'Only Streaming HTTP and SSE transports are supported.',
      sources: [XAI_REMOTE_MCP],
    },
  ],
  quirks: [
    {
      note: 'require_approval and connector_id are accepted by the OpenAPI schema as nullable properties while the prose says they are not supported. Expect silent acceptance and no effect, not a 4xx.',
      sources: [
        XAI_REMOTE_MCP,
        { kind: 'doc', url: 'https://docs.x.ai/openapi.json', retrieved: RETRIEVED, note: 'Both fields present as nullable properties on the mcp tool variant.' },
      ],
      confidence: 'documented',
    },
    {
      note: 'defer_loading hides a server tool definitions from the model prompt while keeping them callable through a tool_search step - the xAI answer to a large catalog, in place of a documented tool cap.',
      sources: [{ kind: 'doc', url: 'https://docs.x.ai/openapi.json', retrieved: RETRIEVED }],
      confidence: 'documented',
    },
    {
      note: 'The xAI native SDK renames two fields: allowed_tools becomes allowed_tool_names and headers becomes extra_headers.',
      sources: [XAI_REMOTE_MCP],
      confidence: 'documented',
    },
  ],
  unknowns: [
    {
      question: 'What protocolVersion does the xAI API remote-MCP tool send, and does it tolerate a differing echo?',
      experiment:
        'The same logging server as the connector experiment, pointed at from an api.x.ai request. Requires an XAI_API_KEY, which this environment does not have.',
      impact: 'The only revision requirement on this profile is inferred and therefore non-gating.',
    },
  ],
}
