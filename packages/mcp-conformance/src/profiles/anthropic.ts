/**
 * Anthropic's MCP clients.
 *
 * Anthropic states that claude.ai, Claude Desktop, Claude mobile, Claude Code,
 * and Cowork share one connector backend, so the hosted surfaces are one
 * profile. Claude Code is separate because it runs the OAuth flow on the user's
 * own machine with its own Client ID Metadata Document, has documented limits
 * the hosted surfaces do not publish, and - as of the current docs - is the
 * one Anthropic client with a documented path to the modern 2026-07-28 era.
 *
 * Note what is deliberately absent from both: **CORS requirements**. Anthropic
 * connectors reach the MCP endpoint from Anthropic's own infrastructure, not
 * from a browser, so no CORS header is an Anthropic client requirement. CORS
 * on the MCP endpoint is carried by the platform-policy profile instead, where it
 * belongs. What Anthropic does warn about is the opposite: over-strict Origin
 * validation rejecting their requests.
 */

import type { Citation, ClientProfile } from '../types.ts'

const RETRIEVED = '2026-08-28'

const CONNECTOR_AUTH: Citation = {
  kind: 'doc',
  url: 'https://claude.com/docs/connectors/building/authentication',
  retrieved: RETRIEVED,
  note: 'Always return a 401 with a WWW-Authenticate header whose resource_metadata parameter points at the protected resource metadata document. The 401 status is required - Claude does not honor WWW-Authenticate on a 200. Fallback order: /.well-known/oauth-protected-resource/<path> first, then /.well-known/oauth-protected-resource. PKCE S256 on every authorization request.',
}

const CONNECTOR_BUILDING: Citation = {
  kind: 'doc',
  url: 'https://claude.com/docs/connectors/building',
  retrieved: RETRIEVED,
  note: 'Supports Streamable HTTP and the legacy HTTP+SSE transport (being deprecated). Auth spec revisions 2025-03-26, 2025-06-18, 2025-11-25. Tools, prompts, and resources supported; resource subscriptions and sampling not. Max tool result ~150,000 characters; 300s timeout.',
}

const CONNECTOR_TROUBLESHOOTING: Citation = {
  kind: 'doc',
  url: 'https://claude.com/docs/connectors/building/troubleshooting',
  retrieved: RETRIEVED,
  note: 'AS metadata order: /.well-known/oauth-authorization-server first, then /.well-known/openid-configuration; only one need return 200. A 3xx to a different host on the MCP URL drops Authorization.',
}

const REVIEW_CRITERIA: Citation = {
  kind: 'doc',
  url: 'https://claude.com/docs/connectors/building/review-criteria',
  retrieved: RETRIEVED,
  note: 'Tool names must be 64 characters or fewer. Every tool must include title plus readOnlyHint: true or destructiveHint: true; these determine auto-permissions - read-only tools can run without per-call confirmation.',
}

const MCP_APPS: Citation = {
  kind: 'spec',
  url: 'https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx',
  retrieved: RETRIEVED,
  note: 'Extension id io.modelcontextprotocol/ui; capability shape { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }; tool linkage _meta.ui.resourceUri to a ui:// resource.',
}

const CLAUDE_CODE_MCP: Citation = {
  kind: 'doc',
  url: 'https://code.claude.com/docs/en/mcp',
  retrieved: RETRIEVED,
  note: 'The v2 runtime is on MCP TypeScript SDK 2.0, which adds protocol revision 2026-07-28; it asks HTTP and claude.ai connector servers whether they support the newer revision and uses it with those that do. Claude Code truncates tool descriptions and server instructions at 2KB each. No fixed per-server tool cap.',
}

const WIDGET_SPEC: Citation = {
  kind: 'repo',
  ref: 'docs/evidence/mcp-apps-widgets.md',
  note: 'Observed against the claude.ai sandbox: widget-initiated tools/call back to its own server works; CDN module fetches fail inside inline embeds; one widget instance per linked tool call.',
}

export const claudeConnectorsProfile: ClientProfile = {
  id: 'claude-connectors',
  displayName: 'Claude connectors (claude.ai, Desktop, mobile, Cowork)',
  vendor: 'Anthropic',
  summary:
    'One backend serves custom connectors across claude.ai, Claude Desktop, Claude mobile and Cowork. It reaches the MCP endpoint from Anthropic infrastructure over the public internet, runs full OAuth 2.1 discovery with PKCE S256, and prefers Client ID Metadata Documents over dynamic client registration. It renders MCP Apps widgets.',
  acceptedProtocolRevisions: ['2025-11-25', '2025-06-18', '2025-03-26'],
  supportsModernEra: false,
  transports: ['streamable-http', 'http-sse-pair'],
  authStrategies: ['oauth-dcr', 'oauth-manual-client', 'static-bearer', 'none'],
  discoverySequence: [
    {
      method: 'POST',
      path: '<mcp endpoint>',
      note: 'Unauthenticated. Expects 401 with WWW-Authenticate: Bearer resource_metadata="...". A 3xx to a different host drops the Authorization header on the retry.',
      sources: [CONNECTOR_AUTH, CONNECTOR_TROUBLESHOOTING],
      confidence: 'documented',
    },
    {
      method: 'GET',
      path: '/.well-known/oauth-protected-resource/<mcp path>',
      note: 'Tried first when the challenge carries no resource_metadata pointer; the origin-root form is the fallback. The resource field must match the MCP URL exactly as the user typed it, path included.',
      sources: [CONNECTOR_AUTH],
      confidence: 'documented',
    },
    {
      method: 'GET',
      path: '<issuer>/.well-known/oauth-authorization-server',
      note: 'Then /.well-known/openid-configuration. Only one need return 200. The issuer may be cross-origin; Claude resolves it regardless of host.',
      sources: [CONNECTOR_TROUBLESHOOTING, CONNECTOR_AUTH],
      confidence: 'documented',
    },
    {
      method: 'POST',
      path: '<registration_endpoint> or none',
      note: 'CIMD when the AS advertises client_id_metadata_document_supported: true and "none" in token_endpoint_auth_methods_supported; RFC 7591 dynamic registration otherwise.',
      sources: [CONNECTOR_AUTH],
      confidence: 'documented',
    },
    {
      method: 'POST',
      path: '<mcp endpoint>',
      note: 'initialize with clientInfo, then the list methods. Claude identifies itself in clientInfo; do not gate behavior on the exact name or version string.',
      sources: [
        {
          kind: 'doc',
          url: 'https://claude.com/docs/connectors/building/testing',
          retrieved: RETRIEVED,
          note: 'Claude identifies itself in the MCP initialize handshake via clientInfo. Do not gate behavior on an exact name or version string.',
        },
      ],
      confidence: 'documented',
    },
  ],
  requirements: [
    {
      check: 'initialize-version-echo',
      confidence: 'documented',
      rationale:
        'Claude connectors run the legacy initialize lifecycle against the three auth-spec revisions Anthropic lists as supported.',
      sources: [CONNECTOR_BUILDING],
      params: { revisions: ['2025-03-26', '2025-06-18', '2025-11-25'] },
    },
    {
      check: 'initialize-never-echoes-modern-revision',
      confidence: 'documented',
      rationale:
        'The hosted surfaces are legacy-era; 2026-07-28 support is only stated as being rolled out, with no surface list and no date.',
      sources: [
        {
          kind: 'doc',
          url: 'https://claude.com/blog/bringing-mcp-2026-07-28-to-claude',
          retrieved: RETRIEVED,
          note: 'Support "is being rolled out across Claude products soon" - no per-surface commitment.',
        },
      ],
    },
    {
      check: 'initialize-server-info',
      confidence: 'documented',
      rationale: 'The connector UI labels the server from serverInfo.',
      sources: [CONNECTOR_BUILDING],
    },
    {
      check: 'initialize-declares-tools-capability',
      confidence: 'documented',
      rationale: 'Tools, prompts, and resources are the supported feature set; capabilities gate which are requested.',
      sources: [CONNECTOR_BUILDING],
    },
    {
      check: 'notification-ack-202',
      confidence: 'observed',
      rationale:
        "Claude Desktop rejects unsolicited id: null frames; a shipping stdio bridge for it has to drop them, which is direct evidence a JSON-RPC answer to a notification breaks this client family.",
      sources: [
        { kind: 'repo', ref: 'tools/mcpb/server/index.js:86-92' },
        { kind: 'repo', ref: 'docs/evidence/grok-connector.md section 2' },
      ],
    },
    {
      check: 'tools-list-shape',
      confidence: 'documented',
      rationale: 'The connector loads its catalog from tools/list immediately after the handshake.',
      sources: [CONNECTOR_BUILDING],
    },
    {
      check: 'resources-list-shape',
      confidence: 'documented',
      rationale: 'Resources are a supported feature; an erroring list makes widget links unresolvable.',
      sources: [CONNECTOR_BUILDING],
    },
    {
      check: 'response-content-type',
      confidence: 'documented',
      rationale: 'Streamable HTTP is the supported transport; a non-MCP media type is not a readable failure.',
      sources: [CONNECTOR_BUILDING],
    },
    {
      check: 'unauthenticated-401-challenge',
      confidence: 'documented',
      rationale:
        'Stated as a hard requirement: the 401 status is required, and Claude does not honor a WWW-Authenticate header on a 200.',
      sources: [CONNECTOR_AUTH],
    },
    {
      check: 'prm-document-served',
      confidence: 'documented',
      rationale:
        'The path-suffixed form is fetched first and the origin-root form second, so serving only one strands whichever lookup runs.',
      sources: [CONNECTOR_AUTH],
    },
    {
      check: 'tool-name-limit',
      confidence: 'documented',
      rationale: 'Tool names must be 64 characters or fewer.',
      sources: [REVIEW_CRITERIA],
      params: { maxToolNameLength: 64 },
    },
    {
      check: 'tool-annotations-present',
      confidence: 'documented',
      rationale:
        'Annotations decide auto-permissions: a read-only tool runs without per-call confirmation, an unannotated one prompts every time.',
      sources: [REVIEW_CRITERIA],
    },
    {
      check: 'mcp-apps-ui-extension',
      confidence: 'documented',
      rationale: 'Claude renders MCP Apps; the extension capability is how a client learns to look for _meta.ui.',
      sources: [MCP_APPS],
    },
    {
      check: 'mcp-apps-ui-resource-resolvable',
      confidence: 'documented',
      rationale: 'The widget is resolved through the resource catalog; an unlisted URI renders as plain output.',
      sources: [MCP_APPS, WIDGET_SPEC],
    },
    {
      check: 'mcp-apps-widget-mime-type',
      confidence: 'documented',
      rationale: 'A host that does not recognise the media type never mounts the component.',
      sources: [MCP_APPS],
    },
    {
      check: 'as-metadata-both-paths',
      confidence: 'inferred',
      rationale:
        'Claude will follow a cross-origin issuer, so the resource-origin mirror is not required of it. Carried as advisory because it costs nothing and is required by other clients.',
      sources: [CONNECTOR_AUTH],
    },
    {
      check: 'as-metadata-pkce-s256',
      confidence: 'documented',
      rationale: 'Claude includes a PKCE code_challenge with code_challenge_method=S256 on every authorization request.',
      sources: [CONNECTOR_AUTH],
    },
  ],
  quirks: [
    {
      note: 'DNS is checked before any HTTP request: every A record must be globally routable. An AAAA-only host, or a host with mixed public and private records, is rejected outright.',
      sources: [CONNECTOR_TROUBLESHOOTING],
      confidence: 'documented',
    },
    {
      note: 'Anthropic egress is 160.79.104.0/21. A WAF or CDN answering 403 or 429 to that range is a common cause of "connection failed" with a healthy server.',
      sources: [CONNECTOR_AUTH, CONNECTOR_TROUBLESHOOTING],
      confidence: 'documented',
    },
    {
      note: 'Over-strict Origin-header validation rejecting Anthropic requests is a documented cause of initialize timeouts. The MCP endpoint should not 403 an unknown Origin.',
      sources: [
        { kind: 'doc', url: 'https://claude.com/docs/connectors/building/testing', retrieved: RETRIEVED },
      ],
      confidence: 'documented',
    },
    {
      note: 'Tool results above ~150,000 characters are written to the code-execution sandbox filesystem instead of passed inline, which silently breaks MCP Apps hydration.',
      sources: [
        {
          kind: 'doc',
          url: 'https://claude.com/docs/connectors/building/mcp-apps/troubleshooting',
          retrieved: RETRIEVED,
        },
      ],
      confidence: 'documented',
    },
    {
      note: 'When a widget resource sets _meta.ui.domain it must equal {first 32 hex of SHA-256(full connector URL)}.claudemcpcontent.com, or Claude shows a ui.domain mismatch instead of rendering.',
      sources: [
        {
          kind: 'doc',
          url: 'https://claude.com/docs/connectors/building/mcp-apps/troubleshooting',
          retrieved: RETRIEVED,
        },
      ],
      confidence: 'documented',
    },
    {
      note: 'Static credentials exist as a beta (static_headers): header names are allowlisted (authorization, x-api-key, x-auth-token, ...), at most four headers, value sent verbatim with no scheme prefix added, and Authorization cannot be set on an OAuth connection.',
      sources: [
        { kind: 'doc', url: 'https://claude.com/docs/connectors/custom/remote-mcp', retrieved: RETRIEVED },
      ],
      confidence: 'documented',
    },
    {
      note: 'Assets an MCP App fetches from the user device DO need CORS, permitting the *.claudemcpcontent.com origin. Do not gate those on Referer - WebKit on iOS omits it. This is the only place CORS matters for this client, and it is not the MCP endpoint.',
      sources: [
        {
          kind: 'doc',
          url: 'https://claude.com/docs/connectors/building/mcp-apps/troubleshooting',
          retrieved: RETRIEVED,
        },
      ],
      confidence: 'documented',
    },
  ],
  unknowns: [
    {
      question:
        'What exact protocolVersion string does claude.ai send on initialize, does it send MCP-Protocol-Version on post-initialize requests, and does it tolerate a server echoing a revision it did not request?',
      experiment:
        'Deploy a hosted MCP server in public mode that logs the raw initialize body and all request headers, add it as a custom connector on each surface, and record params.protocolVersion and clientInfo. Then a second server that always echoes 2025-11-25 regardless of request, to separate "requires echo" from "tolerant".',
      impact:
        'Decides whether initialize-version-echo can be raised from documented to observed for this client, and whether the revision list is right.',
    },
    {
      question: 'Does claude.ai use mcp-session-id, require the GET/SSE stream, or send DELETE?',
      experiment:
        'Probe server that mints no session id and answers GET with 405; connect and see whether either breaks the connection.',
      impact: 'Would let session-header-absent-or-echoed and sse-get-stream be carried as observed rather than inherited from the baseline.',
    },
    {
      question: 'What is the maximum number of tools claude.ai and Desktop will load from one connector?',
      experiment:
        'Deploy probe servers exposing 100 / 250 / 300 / 600 tools and count what tools/list surfaces in the UI. Third-party reports of a 256-tool ceiling exist but no Anthropic document states one.',
      impact:
        'A tool-count-limit requirement cannot be carried until this is sourced; a 76-tool catalogue was already in production against this client, so it may already be near a real ceiling.',
    },
    {
      question:
        'Is the 64-character tool-name limit enforced at connect time, or only by directory review?',
      experiment: 'Expose a 65-character tool name and observe whether the whole server fails or only that tool is dropped.',
      impact: 'Decides whether tool-name-limit is a connect gate or a submission gate.',
    },
    {
      question: 'How are $ref, oneOf, anyOf, and allOf handled in a tool inputSchema?',
      experiment:
        'One tool with a local $ref, one with an external $ref, one with a root-level oneOf; see whether each is dropped, flattened, or errors.',
      impact: 'A schema-shape requirement cannot be written without this.',
    },
  ],
}

export const claudeCodeProfile: ClientProfile = {
  id: 'claude-code',
  displayName: 'Claude Code',
  vendor: 'Anthropic',
  summary:
    'The Claude Code CLI adds remote servers with `claude mcp add --transport http`. It runs its own OAuth flow on the user machine with a loopback redirect and its own Client ID Metadata Document, so it needs no Anthropic-held credentials. On the v2 runtime it asks HTTP servers whether they speak 2026-07-28 and uses it with those that do - making it the one Anthropic client with a documented modern-era path.',
  acceptedProtocolRevisions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'],
  supportsModernEra: true,
  transports: ['streamable-http', 'streamable-http-sse'],
  authStrategies: ['oauth-manual-client', 'oauth-dcr', 'static-bearer', 'custom-headers', 'none'],
  discoverySequence: [
    {
      method: 'POST',
      path: '<mcp endpoint>',
      note: 'On the v2 runtime with negotiation enabled, Claude Code first asks whether the server supports the newer revision, then falls back to the legacy initialize handshake. The exact probe shape is not documented - see unknowns.',
      sources: [CLAUDE_CODE_MCP],
      confidence: 'documented',
    },
    {
      method: 'GET',
      path: '/.well-known/oauth-protected-resource/<mcp path>',
      note: 'Same PRM and AS discovery machinery as the hosted connectors; Anthropic states the same infrastructure backs both.',
      sources: [CONNECTOR_AUTH],
      confidence: 'documented',
    },
  ],
  requirements: [
    {
      check: 'initialize-version-echo',
      confidence: 'documented',
      rationale: 'The legacy handshake is the fallback path and the default in several session types.',
      sources: [CLAUDE_CODE_MCP, CONNECTOR_BUILDING],
      params: { revisions: ['2025-03-26', '2025-06-18', '2025-11-25'] },
    },
    {
      check: 'initialize-never-echoes-modern-revision',
      confidence: 'documented',
      rationale:
        'Claude Code reaches the modern era by asking, not by initialize. A modern revision echoed from initialize is outside SDK 1.x supported set and hard-throws on the v1 runtime, which is still the default in several session types.',
      sources: [CLAUDE_CODE_MCP],
    },
    {
      check: 'initialize-declares-tools-capability',
      confidence: 'documented',
      rationale: 'SDK-based client; the capability assertion gates the method.',
      sources: [
        {
          kind: 'doc',
          url: 'https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/client/index.ts',
          retrieved: RETRIEVED,
        },
      ],
    },
    {
      check: 'notification-ack-202',
      confidence: 'documented',
      rationale: 'SDK transport requirement.',
      sources: [
        {
          kind: 'spec',
          url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports',
          retrieved: RETRIEVED,
        },
      ],
    },
    {
      check: 'tools-list-shape',
      confidence: 'documented',
      rationale:
        'Claude Code validates a tool input schema against the JSON Schema draft 2020-12 meta-schema when the schema declares no $schema or declares that draft.',
      sources: [CLAUDE_CODE_MCP],
    },
    {
      check: 'tool-description-limit',
      confidence: 'documented',
      rationale: 'Claude Code truncates tool descriptions and server instructions at 2KB each.',
      sources: [CLAUDE_CODE_MCP],
      params: { maxToolDescriptionLength: 2048 },
    },
    {
      check: 'unauthenticated-401-challenge',
      confidence: 'documented',
      rationale: 'Same OAuth discovery machinery as the hosted connectors.',
      sources: [CONNECTOR_AUTH],
    },
    {
      check: 'prm-document-served',
      confidence: 'documented',
      rationale: 'Same PRM fallback order as the hosted connectors.',
      sources: [CONNECTOR_AUTH],
    },
    {
      check: 'as-metadata-pkce-s256',
      confidence: 'documented',
      rationale: 'PKCE S256 on every authorization request, and the v2 runtime also validates the RFC 9207 iss.',
      sources: [CONNECTOR_AUTH, CLAUDE_CODE_MCP],
    },
    {
      check: 'response-content-type',
      confidence: 'documented',
      rationale: 'SDK transport throws on any other media type.',
      sources: [
        {
          kind: 'doc',
          url: 'https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/client/streamableHttp.ts',
          retrieved: RETRIEVED,
        },
      ],
    },
    {
      check: 'server-discover',
      confidence: 'inferred',
      rationale:
        'The v2 runtime asks HTTP servers whether they support the newer revision, and server/discover is how the SDK 2.0 client probes. The probe shape is not documented for Claude Code specifically, so this is advisory until observed.',
      sources: [
        CLAUDE_CODE_MCP,
        {
          kind: 'doc',
          url: 'https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/packages/client/src/client/versionNegotiation.ts',
          retrieved: RETRIEVED,
          note: "Mode 'auto' probes with server/discover and conservatively falls back to the legacy initialize handshake unless modern evidence is definitive.",
        },
      ],
    },
  ],
  quirks: [
    {
      note: 'Claude Code namespaces tools as mcp__<server>__<tool_name>, and the whole string must be at most 64 characters for the Claude API. A long server name eats the tool-name budget, so 64 is not the per-tool budget in practice.',
      sources: [
        { kind: 'doc', url: 'https://github.com/anthropics/claude-code/issues/21050', retrieved: RETRIEVED },
      ],
      confidence: 'documented',
    },
    {
      note: 'The Claude API does not accept anyOf, oneOf, or allOf at the root of a tool input schema. Claude Code flattens such a schema into a single object and prepends a sentence to the description rather than failing, but a direct API caller sees a rejection.',
      sources: [CLAUDE_CODE_MCP],
      confidence: 'documented',
    },
    {
      note: 'Claude Code declares its client identity at https://claude.ai/oauth/claude-code-client-metadata with redirect_uris ["http://localhost/callback","http://127.0.0.1/callback"]. An authorization server must match both with the port ignored, per RFC 8252.',
      sources: [
        { kind: 'doc', url: 'https://claude.ai/oauth/claude-code-client-metadata', retrieved: RETRIEVED },
        CONNECTOR_AUTH,
      ],
      confidence: 'documented',
    },
    {
      note: 'In a Claude Code on the web session, protocol negotiation is off unless MCP_PROTOCOL_NEGOTIATION is set to auto - so that session type is legacy-only by default even on the v2 runtime.',
      sources: [CLAUDE_CODE_MCP],
      confidence: 'documented',
    },
    {
      note: 'Tool output defaults to a 25,000-token maximum, with a warning above 10,000. _meta["anthropic/maxResultSizeChars"] raises a single tool persist-to-disk threshold up to 500,000 characters.',
      sources: [CLAUDE_CODE_MCP],
      confidence: 'documented',
    },
  ],
  unknowns: [
    {
      question:
        'How exactly does Claude Code v2 "ask" whether a server supports the newer revision - a server/discover POST, a modern request carrying _meta, or an initialize naming 2026-07-28?',
      experiment:
        'Run MCP_SDK_GENERATION=v2 MCP_PROTOCOL_NEGOTIATION=auto claude against a probe server that logs every request and header, and capture the first POST.',
      impact:
        'This is the highest-value open experiment in the registry. It decides whether the repo rule that initialize can never reach the modern era strands Claude Code v2, and whether server-discover can become a gating requirement for this profile.',
    },
    {
      question: 'Does the Claude Code TUI render MCP Apps widgets?',
      experiment: 'Add a known-good MCP Apps server to Claude Code and see whether anything renders or _meta.ui is ignored.',
      impact: 'Decides whether the MCP Apps requirements belong on this profile at all.',
    },
    {
      question: 'How does Claude Code handle a $ref in a tool input schema?',
      experiment: 'One tool with a local $ref and one with an external $ref; observe whether the tool is dropped, flattened, or errors.',
      impact: 'Draft 2020-12 validation is documented, but $ref resolution behavior is not.',
    },
  ],
  disagreements: [
    {
      topic: 'Whether Claude Code is legacy-era',
      positions: [
        'docs/dual-era-policy.md (2026-08-20) states claude.ai, Claude Code, and ChatGPT are all legacy-era today.',
        'code.claude.com/docs/en/mcp (retrieved 2026-08-28) documents a v2 runtime on SDK 2.0 that adds revision 2026-07-28 and asks HTTP servers whether they support it.',
      ],
      resolution:
        'The vendor documentation is newer and specific, so it wins: Claude Code is dual-era-capable on the v2 runtime. The repo policy doc has been corrected as part of this change. The hosted connector surfaces remain legacy-era - the correction is Claude-Code-specific, not a general one.',
    },
  ],
}
