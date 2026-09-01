/**
 * OpenAI's MCP clients.
 *
 * As of the current documentation OpenAI has merged the Apps SDK and ChatGPT
 * custom connectors into one product surface called plugins - the pages under
 * /apps-sdk/ and /plugins/ return identical content. They are therefore one
 * wire profile with an optional UI layer, not two.
 *
 * Three distinct clients remain:
 * - `chatgpt-plugins` - the connector inside ChatGPT. OAuth only; it refuses
 *   static API keys outright.
 * - `chatgpt-deep-research` - the same transport, but the model only calls a
 *   fixed two-tool contract (`search` / `fetch`). A server without those two
 *   tools is not partly compatible; it is not called at all.
 * - `openai-responses-api` - the API-side remote MCP tool. The mirror image of
 *   the connector: it runs no OAuth at all and takes a static bearer you
 *   supply, and it is the only OpenAI surface that accepts the deprecated
 *   HTTP+SSE pair transport.
 */

import type { Citation, ClientProfile } from '../types.ts'

const RETRIEVED = '2026-08-28'

const PLUGINS_SERVER: Citation = {
  kind: 'doc',
  url: 'https://developers.openai.com/plugins/build/mcp-server.md',
  retrieved: RETRIEVED,
  note: 'Support the MCP streamable HTTP transport. Respond at a stable URL, typically ending in /mcp.',
}

const PLUGINS_AUTH: Citation = {
  kind: 'doc',
  url: 'https://developers.openai.com/plugins/build/auth.md',
  retrieved: RETRIEVED,
  note: 'OAuth 2.1 with PKCE S256: MCP servers are unsupported when their authorization server metadata omits code_challenge_methods_supported or does not advertise S256. PRM per RFC 9728 at /.well-known/oauth-protected-resource or advertised via WWW-Authenticate on a 401. ChatGPT does not support machine-to-machine grants and cannot present custom API keys.',
}

const PLUGINS_REFERENCE: Citation = {
  kind: 'doc',
  url: 'https://developers.openai.com/plugins/reference.md',
  retrieved: RETRIEVED,
  note: '_meta.ui.resourceUri is the preferred widget link, with openai/outputTemplate as a compatibility alias. readOnlyHint, destructiveHint and openWorldHint are marked required in the annotations table. openai/toolInvocation/invoking and /invoked are capped at 64 characters.',
}

const PLUGINS_UI: Citation = {
  kind: 'doc',
  url: 'https://developers.openai.com/plugins/build/chatgpt-ui.md',
  retrieved: RETRIEVED,
  note: 'Widget resources use mimeType text/html;profile=mcp-app and a ui:// resource URI.',
}

const PLUGINS_TROUBLESHOOTING: Citation = {
  kind: 'doc',
  url: 'https://developers.openai.com/plugins/deploy/troubleshooting.md',
  retrieved: RETRIEVED,
  note: 'No tools listed means the wrong endpoint. Structured content with no component means the tool lacks _meta.ui.resourceUri pointing at a registered resource with mimeType text/html;profile=mcp-app. A 401 without WWW-Authenticate means ChatGPT will not restart OAuth.',
}

const DEEP_RESEARCH: Citation = {
  kind: 'doc',
  url: 'https://developers.openai.com/api/docs/mcp.md',
  retrieved: RETRIEVED,
  note: 'Exactly two read-only tools named search and fetch. search takes a single query string; fetch takes a single string id. The result object goes in structuredContent and the identical value goes JSON-encoded in content[0].text. ChatGPT creates citation metadata only when url is a non-empty string.',
}

const RESPONSES_API: Citation = {
  kind: 'doc',
  url: 'https://developers.openai.com/api/reference/resources/responses/methods/create.md',
  retrieved: RETRIEVED,
  note: 'The mcp tool takes type, server_label (required), and one of server_url / connector_id / tunnel_id, plus optional server_description, authorization (an OAuth access token your application obtains), headers, allowed_tools, require_approval, defer_loading, allowed_callers.',
}

const RESPONSES_TRANSPORT: Citation = {
  kind: 'doc',
  url: 'https://developers.openai.com/api/docs/guides/tools-connectors-mcp.md',
  retrieved: RETRIEVED,
  note: 'The Responses API works with remote MCP servers that support either the Streamable HTTP or the HTTP/SSE transport protocols.',
}

const SESSION_ISSUE: Citation = {
  kind: 'doc',
  url: 'https://github.com/openai/openai-apps-sdk-examples/issues/165',
  retrieved: RETRIEVED,
  note: 'Reporter observes a new MCP session initialized for every tool call; no maintainer reply as of retrieval. Session affinity must never be required.',
}

export const chatgptPluginsProfile: ClientProfile = {
  id: 'chatgpt-plugins',
  displayName: 'ChatGPT plugins (Apps SDK / custom connectors)',
  vendor: 'OpenAI',
  summary:
    'The connector inside ChatGPT, formerly split between the Apps SDK and custom connectors. Streamable HTTP at a stable /mcp URL, reached server-side from OpenAI infrastructure. OAuth 2.1 with PKCE S256 is the only credential path - static API keys are explicitly unsupported. It renders MCP Apps widgets, with both the standard and a legacy OpenAI spelling of every UI key.',
  acceptedProtocolRevisions: ['2025-11-25', '2025-06-18', '2025-03-26'],
  supportsModernEra: false,
  transports: ['streamable-http'],
  authStrategies: ['oauth-dcr', 'oauth-manual-client', 'none'],
  discoverySequence: [
    {
      method: 'GET',
      path: '/.well-known/oauth-protected-resource',
      note: 'Or discovered from a 401 WWW-Authenticate challenge. Required fields: resource, authorization_servers.',
      sources: [PLUGINS_AUTH],
      confidence: 'documented',
    },
    {
      method: 'GET',
      path: '<issuer>/.well-known/oauth-authorization-server or /.well-known/openid-configuration',
      note: 'ChatGPT tries each authorization_servers entry. The document must advertise S256 in code_challenge_methods_supported or the server is unsupported.',
      sources: [PLUGINS_AUTH],
      confidence: 'documented',
    },
    {
      method: 'POST',
      path: '<registration_endpoint> or none',
      note: 'CIMD preferred - ChatGPT client_id is https://chatgpt.com/oauth/client.json. Dynamic registration happens once per MCP server connection and is then reused.',
      sources: [PLUGINS_AUTH],
      confidence: 'documented',
    },
    {
      method: 'POST',
      path: '<mcp endpoint>',
      note: 'MCP lifecycle with Authorization: Bearer. The resource parameter is sent on both authorization and token requests and is expected in aud.',
      sources: [PLUGINS_AUTH],
      confidence: 'documented',
    },
  ],
  requirements: [
    {
      check: 'initialize-version-echo',
      confidence: 'inferred',
      rationale:
        'OpenAI publishes no accepted-revision list. The docs cite 2025-06-18 and 2025-11-25 in passing, and a repo test records those two as the host matrix ChatGPT connects with, but the exact requested revision and echo tolerance are unsourced.',
      sources: [
        PLUGINS_SERVER,
        { kind: 'repo', ref: 'protocol regression test: "the host matrix Claude.ai and ChatGPT connect with is unchanged"', note: 'A production surface pins these two revisions as the host matrix ChatGPT connects with.' },
      ],
      params: { revisions: ['2025-06-18', '2025-11-25'] },
    },
    {
      check: 'response-content-type',
      confidence: 'documented',
      rationale: 'Streamable HTTP is the required transport; a buffering proxy or an HTML error page breaks the connection.',
      sources: [PLUGINS_SERVER, PLUGINS_TROUBLESHOOTING],
    },
    {
      check: 'tools-list-shape',
      confidence: 'documented',
      rationale: '"No tools listed" is the documented symptom of an endpoint that does not answer tools/list correctly.',
      sources: [PLUGINS_TROUBLESHOOTING],
    },
    {
      check: 'resources-list-shape',
      confidence: 'documented',
      rationale: 'Widget resources are resolved through the resource catalog.',
      sources: [PLUGINS_TROUBLESHOOTING],
    },
    {
      check: 'notification-ack-202',
      confidence: 'documented',
      rationale: 'Streamable HTTP transport requirement, inherited by every client that speaks it.',
      sources: [
        {
          kind: 'spec',
          url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports',
          retrieved: RETRIEVED,
        },
      ],
    },
    {
      check: 'unauthenticated-401-challenge',
      confidence: 'documented',
      rationale:
        'A 401 without WWW-Authenticate is listed as the reason ChatGPT will not restart OAuth. The documented challenge form carries resource_metadata and a scope parameter.',
      sources: [PLUGINS_AUTH, PLUGINS_TROUBLESHOOTING],
    },
    {
      check: 'prm-document-served',
      confidence: 'documented',
      rationale: 'RFC 9728 protected resource metadata with resource and authorization_servers is required.',
      sources: [PLUGINS_AUTH],
    },
    {
      check: 'as-metadata-pkce-s256',
      confidence: 'documented',
      rationale:
        'The one unambiguous hard gate in the OpenAI auth documentation: a server whose AS metadata omits the field or does not advertise S256 is unsupported.',
      sources: [PLUGINS_AUTH],
    },
    {
      check: 'session-header-absent-or-echoed',
      confidence: 'inferred',
      rationale:
        'ChatGPT is reported to initialize a new MCP session for every tool call, so a server that requires session affinity would lose state between calls. Inferred rather than observed: the evidence is an unanswered community bug report, and no OpenAI document mentions mcp-session-id at all.',
      sources: [SESSION_ISSUE],
    },
    {
      check: 'tool-annotations-present',
      confidence: 'documented',
      rationale: 'readOnlyHint, destructiveHint and openWorldHint are marked required in the annotations reference.',
      sources: [PLUGINS_REFERENCE],
    },
    {
      check: 'mcp-apps-ui-resource-resolvable',
      confidence: 'documented',
      rationale:
        '"Structured content only, no component" is the documented symptom of a tool whose widget link does not resolve to a registered resource.',
      sources: [PLUGINS_TROUBLESHOOTING, PLUGINS_REFERENCE],
    },
    {
      check: 'mcp-apps-widget-mime-type',
      confidence: 'documented',
      rationale: 'The resource must declare text/html;profile=mcp-app (the legacy text/html+skybridge spelling still ships in OpenAI own examples).',
      sources: [PLUGINS_UI, PLUGINS_TROUBLESHOOTING],
    },
    {
      check: 'mcp-apps-ui-extension',
      confidence: 'inferred',
      rationale:
        'OpenAI documents the per-tool _meta link and the resource media type, but does not state that the initialize capability declaration is required. Advisory rather than gating.',
      sources: [PLUGINS_REFERENCE],
    },
  ],
  quirks: [
    {
      note: 'Two spellings live simultaneously for every UI key: _meta.ui.resourceUri / openai/outputTemplate, _meta.ui.csp (camelCase) / openai/widgetCSP (snake_case), ui.prefersBorder / openai/widgetPrefersBorder, ui.domain / openai/widgetDomain, and text/html;profile=mcp-app / text/html+skybridge. A server that emits only one spelling will fail against some hosts; a checker that accepts only one will produce false failures against OpenAI own published examples.',
      sources: [PLUGINS_REFERENCE, PLUGINS_UI],
      confidence: 'documented',
    },
    {
      note: '_meta.ui.csp carries no redirect_domains, so a widget using window.openai.openExternal must still emit the legacy openai/widgetCSP key with redirect_domains even in an otherwise standards-clean implementation.',
      sources: [PLUGINS_REFERENCE],
      confidence: 'documented',
    },
    {
      note: 'Tool-level OAuth linking needs both halves: securitySchemes metadata plus runtime errors carrying _meta["mcp/www_authenticate"] with both error and error_description. Without both, ChatGPT does not show the linking UI for that tool.',
      sources: [PLUGINS_AUTH],
      confidence: 'documented',
    },
    {
      note: 'Metadata is cached. After changing the tool catalog you must hit Refresh on the connection in developer mode; published plugins use reviewed metadata snapshots and need a re-scan and resubmit.',
      sources: [PLUGINS_TROUBLESHOOTING],
      confidence: 'documented',
    },
    {
      note: 'ChatGPT requires manual confirmation in a conversation before write actions, and the documentation warns that a write action can still occur even when the server tagged the tool read-only. Do not rely on readOnlyHint as a safety boundary.',
      sources: [{ kind: 'doc', url: 'https://developers.openai.com/api/docs/mcp.md', retrieved: RETRIEVED }],
      confidence: 'documented',
    },
    {
      note: 'The MCP endpoint is fetched server-side; no OpenAI documentation mentions CORS for it. CORS matters only for what the widget iframe fetches, whose default origin is https://web-sandbox.oaiusercontent.com or the plugin own _meta.ui.domain.',
      sources: [PLUGINS_REFERENCE],
      confidence: 'documented',
    },
  ],
  unknowns: [
    {
      question:
        'What protocolVersion does ChatGPT send on initialize, does it send MCP-Protocol-Version on later posts, and does it tolerate a differing echo?',
      experiment:
        'A /mcp endpoint that logs the raw initialize body and all headers, connected in developer mode at chatgpt.com/plugins. Then a variant that echoes a deliberately different revision, and a third that echoes 2026-07-28, to test tolerance and modern-era reach.',
      impact: 'initialize-version-echo is inferred and therefore non-gating for this profile until this is run.',
    },
    {
      question: 'What are the tool-count, tool-name, and description limits for a ChatGPT plugin?',
      experiment:
        'Binary-search a server advertising 16 / 32 / 64 / 128 / 256 tools, and one with a 4KB description and a 512-character name; record where Scan Tools or the connection refresh fails.',
      impact:
        'No OpenAI source states any of these. Third-party figures circulate (128 tools, 1024-character descriptions) but those are Chat Completions function-calling limits, not MCP-plugin limits, and must not gate CI.',
    },
    {
      question:
        'What .well-known probe order does ChatGPT use, and does it try the RFC 9728 path-insertion variants such as /.well-known/oauth-protected-resource/mcp?',
      experiment: 'Serve the PRM at one variant at a time and log which paths are requested, with timestamps.',
      impact: 'Decides whether prm-document-served should require both paths for this client, as it does for Claude.',
    },
    {
      question: 'Does ChatGPT still accept the legacy text/html+skybridge widget media type?',
      experiment: 'Publish two identical widgets differing only in mimeType and see which renders.',
      impact: 'The checker accepts both today; if skybridge is dead, tightening removes a false pass.',
    },
  ],
  disagreements: [
    {
      topic: 'Whether ChatGPT requires an SSE endpoint',
      positions: [
        'developers.openai.com/api/docs/mcp.md instructs that the dev URL must end with /sse/ and runs its reference server with transport="sse".',
        'developers.openai.com/plugins/build/mcp-server.md, same site and same day, requires streamable HTTP at /mcp.',
      ],
      resolution:
        'The /sse/ instruction is Responses-API-era guidance that survived the plugins rewrite. The Responses API genuinely accepts both transports; ChatGPT plugins require streamable HTTP. Encoded that way, and no server is marked deep-research-incompatible for lacking an /sse endpoint.',
    },
  ],
}

export const chatgptDeepResearchProfile: ClientProfile = {
  id: 'chatgpt-deep-research',
  displayName: 'ChatGPT deep research / company knowledge',
  vendor: 'OpenAI',
  summary:
    'Deep research and company knowledge do not consume an arbitrary MCP catalog. The model is optimized for exactly two read-only tools, search and fetch, with a fixed input and output shape, and does not call servers that do not implement that interface. Everything else about the transport and auth matches the plugins profile.',
  acceptedProtocolRevisions: ['2025-11-25', '2025-06-18', '2025-03-26'],
  supportsModernEra: false,
  transports: ['streamable-http'],
  authStrategies: ['oauth-dcr', 'oauth-manual-client', 'none'],
  discoverySequence: [],
  requirements: [
    {
      check: 'deep-research-search-fetch-contract',
      confidence: 'documented',
      rationale:
        'The model does not support tool calls or MCP servers that do not implement this interface. Without the two tools the server is not partly compatible - it is never called.',
      sources: [
        DEEP_RESEARCH,
        {
          kind: 'doc',
          url: 'https://developers.openai.com/api/docs/guides/deep-research.md',
          retrieved: RETRIEVED,
          note: "The model is optimized to call data sources exposed through this interface and doesn't support tool calls or MCP servers that don't implement this interface.",
        },
      ],
    },
    {
      check: 'tool-annotations-present',
      confidence: 'documented',
      rationale:
        'Company knowledge requires the search and fetch input schemas plus readOnlyHint: true on other read-only tools.',
      sources: [PLUGINS_SERVER],
    },
    {
      check: 'tools-list-shape',
      confidence: 'documented',
      rationale: 'A declared output schema per tool is required so clients can validate the result shape.',
      sources: [DEEP_RESEARCH],
    },
    {
      check: 'unauthenticated-401-challenge',
      confidence: 'documented',
      rationale: 'Same auth machinery as the plugins profile.',
      sources: [PLUGINS_AUTH],
    },
  ],
  quirks: [
    {
      note: 'search results carry exactly id, title, url. text and metadata belong to fetch, not to search - widely-repeated third-party claims to the contrary do not match the documented prose or the reference model.',
      sources: [DEEP_RESEARCH],
      confidence: 'documented',
    },
    {
      note: 'Citation metadata is created only when url is a non-empty string. A result with a title but no usable url stays ordinary tool output instead of becoming a citation.',
      sources: [DEEP_RESEARCH],
      confidence: 'documented',
    },
    {
      note: 'On the API side, deep research requires the MCP tool approval mode to be require_approval: never.',
      sources: [
        { kind: 'doc', url: 'https://developers.openai.com/api/docs/guides/deep-research.md', retrieved: RETRIEVED },
      ],
      confidence: 'documented',
    },
  ],
  unknowns: [
    {
      question: 'Would a dedicated search/fetch facade over the tool catalogue be worth building?',
      experiment:
        'Add a search(query) tool over list_deployments / list_projects / list_gateways and a fetch(id) tool returning the deployment detail, then connect it as a deep-research source and confirm citations render.',
      impact:
        'This is the one OpenAI surface an operations-shaped catalogue fails by construction. It is a product decision, not a bug: the contract is narrow and deliberate.',
    },
  ],
}

export const openaiResponsesApiProfile: ClientProfile = {
  id: 'openai-responses-api',
  displayName: 'OpenAI Responses API remote MCP tool',
  vendor: 'OpenAI',
  summary:
    'The API-side mirror of the connector. It runs no OAuth: the caller supplies a static access token in `authorization` or arbitrary `headers`, resent on every request. It is the only OpenAI surface that explicitly accepts the deprecated HTTP+SSE pair transport, and the only one with require_approval and connector_id - the two fields xAI does not support.',
  acceptedProtocolRevisions: ['2025-11-25', '2025-06-18', '2025-03-26'],
  supportsModernEra: false,
  transports: ['streamable-http', 'http-sse-pair'],
  authStrategies: ['static-bearer', 'custom-headers', 'none'],
  discoverySequence: [
    {
      method: 'POST',
      path: '<mcp endpoint>',
      note: 'No discovery: initialize then tools/list, with the supplied authorization and headers applied. The tool listing is cached in context as an mcp_list_tools item and is not re-listed while present.',
      sources: [RESPONSES_API],
      confidence: 'documented',
    },
  ],
  requirements: [
    {
      check: 'initialize-version-echo',
      confidence: 'inferred',
      rationale:
        'No revision is documented for this surface; the only version reference is a link to the 2025-03-26 tool error semantics.',
      sources: [RESPONSES_TRANSPORT],
      params: { revisions: ['2025-03-26', '2025-06-18', '2025-11-25'] },
    },
    {
      check: 'tools-list-shape',
      confidence: 'documented',
      rationale: 'The tool catalog is imported into the model prompt as an mcp_list_tools item.',
      sources: [RESPONSES_API],
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
      rationale: 'Both accepted transports frame responses as JSON or SSE.',
      sources: [RESPONSES_TRANSPORT],
    },
    {
      check: 'tool-annotations-present',
      confidence: 'documented',
      rationale:
        'require_approval filters accept read_only: true, which matches servers and tools annotated with readOnlyHint. An unannotated tool always prompts.',
      sources: [RESPONSES_API],
    },
    {
      check: 'session-header-absent-or-echoed',
      confidence: 'inferred',
      rationale: 'Session handling is undocumented for this surface; a stateless server is the safe shape.',
      sources: [RESPONSES_API],
    },
  ],
  quirks: [
    {
      note: 'authorization is not stored and is not echoed back in the Response object - it must be resent on every request.',
      sources: [RESPONSES_API],
      confidence: 'documented',
    },
    {
      note: 'Approval is on by default: OpenAI requests user approval before any data is shared, surfaced as an mcp_approval_request output item that the caller answers with mcp_approval_response.',
      sources: [RESPONSES_API],
      confidence: 'documented',
    },
    {
      note: 'connector_id accepts exactly eight first-party values (Dropbox, Gmail, Google Calendar, Google Drive, Microsoft Teams, Outlook Calendar, Outlook Email, SharePoint). A custom server is reached through server_url or tunnel_id instead.',
      sources: [RESPONSES_API],
      confidence: 'documented',
    },
  ],
  unknowns: [
    {
      question: 'Does the Responses API send MCP-Protocol-Version, and does it reuse sessions across turns?',
      experiment: 'A probe server logging all headers, driven from POST /v1/responses with an mcp tool entry.',
      impact: 'Both requirements on this profile are inferred and non-gating until answered.',
    },
  ],
}
