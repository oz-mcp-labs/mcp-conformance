/**
 * The unopinionated, spec-conformant client.
 *
 * This profile is the floor. It encodes what the MCP specification itself
 * requires of a Streamable HTTP server, plus the handful of behaviors the two
 * official SDKs enforce in code (and therefore turn from a SHOULD into a
 * connect-or-not). A surface that fails this profile fails every client;
 * a surface that passes it is not yet proven against any particular vendor,
 * which is what the other profiles are for.
 *
 * Two SDK behaviors are load-bearing and are the reason several spec SHOULDs
 * are carried here as gating requirements:
 *
 * - The official TypeScript SDK 1.x throws `Server's protocol version is not
 *   supported` when `initialize` echoes a revision outside its own supported
 *   set, which does not include `2026-07-28`. The Python SDK raises the
 *   equivalent `RuntimeError`. So echoing a modern revision from `initialize`
 *   does not degrade a legacy client - it disconnects it.
 * - The TypeScript SDK asserts the server's declared capability before calling
 *   a method, so a server that omits `capabilities.tools` is never asked for
 *   its tools and reads as empty rather than broken.
 */

import type { Citation, ClientProfile } from '../types.ts'

const RETRIEVED = '2026-08-28'

const SPEC_TRANSPORT: Citation = {
  kind: 'spec',
  url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports',
  retrieved: RETRIEVED,
  note: 'Streamable HTTP: a POST carrying a notification is answered 202 with no body; a POST carrying a request answers application/json or text/event-stream; GET returns 405 when no standalone stream is offered.',
}

const SPEC_LIFECYCLE: Citation = {
  kind: 'spec',
  url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle',
  retrieved: RETRIEVED,
  note: 'Version negotiation: the server responds with the same version when it supports it, otherwise another version it supports. The server MUST respond with its own capabilities and information.',
}

const SDK_TS_CLIENT: Citation = {
  kind: 'doc',
  url: 'https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/client/index.ts',
  retrieved: RETRIEVED,
  note: "Throws `Server's protocol version is not supported: ${result.protocolVersion}` when the echoed revision is outside SUPPORTED_PROTOCOL_VERSIONS, and asserts the server capability before dispatching a method.",
}

const SDK_TS_TYPES: Citation = {
  kind: 'doc',
  url: 'https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/types.ts',
  retrieved: RETRIEVED,
  note: "SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25','2025-06-18','2025-03-26','2024-11-05','2024-10-07'] - 2026-07-28 is absent.",
}

const SDK_TS_TRANSPORT: Citation = {
  kind: 'doc',
  url: 'https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/client/streamableHttp.ts',
  retrieved: RETRIEVED,
  note: 'Throws `Unexpected content type` for any POST response media type other than application/json or text/event-stream; treats 405 on GET and on DELETE as benign.',
}

const SDK_PY_SESSION: Citation = {
  kind: 'doc',
  url: 'https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/src/mcp/client/session.py',
  retrieved: RETRIEVED,
  note: 'Raises RuntimeError("Unsupported protocol version from the server") when the echoed revision is outside HANDSHAKE_PROTOCOL_VERSIONS.',
}

const MCPB_RELAY: Citation = {
  kind: 'repo',
  ref: 'tools/mcpb/server/index.js:86-92',
  note: "A shipping Claude Desktop stdio bridge drops id-less replies to notifications, with the comment that Claude Desktop rejects unsolicited id: null frames. Answering a notification with a JSON-RPC body breaks it.",
}

export const specBaselineProfile: ClientProfile = {
  id: 'mcp-spec-baseline',
  displayName: 'Spec-conformant MCP client',
  vendor: 'Model Context Protocol',
  summary:
    'The floor every other profile sits on: the official TypeScript and Python SDK clients, mcp-remote (which pins SDK 1.x), and MCP Inspector. Nothing here is vendor-specific - it is the specification plus the handful of SHOULDs the official SDKs enforce in code, which makes them connect-or-not in practice.',
  acceptedProtocolRevisions: ['2025-11-25', '2025-06-18', '2025-03-26'],
  supportsModernEra: true,
  transports: ['streamable-http', 'streamable-http-sse'],
  authStrategies: ['oauth-dcr', 'oauth-manual-client', 'static-bearer', 'none'],
  discoverySequence: [
    {
      method: 'POST',
      path: '<mcp endpoint>',
      note: 'initialize, sending the SDK latest revision (2025-11-25 for TS 1.x) and no MCP-Protocol-Version header - the header is only set from the initialize result.',
      sources: [SDK_TS_TRANSPORT],
      confidence: 'documented',
    },
    {
      method: 'POST',
      path: '<mcp endpoint>',
      note: 'notifications/initialized. Expects 202 with no body.',
      sources: [SPEC_TRANSPORT],
      confidence: 'documented',
    },
    {
      method: 'GET',
      path: '<mcp endpoint>',
      note: 'Optional standalone SSE stream, opened after notifications/initialized. A 405 is swallowed and the session continues.',
      sources: [SDK_TS_TRANSPORT],
      confidence: 'documented',
    },
    {
      method: 'POST',
      path: '<mcp endpoint>',
      note: 'tools/list, now stamping MCP-Protocol-Version with the negotiated revision.',
      sources: [SDK_TS_TRANSPORT],
      confidence: 'documented',
    },
  ],
  requirements: [
    {
      check: 'initialize-version-echo',
      confidence: 'documented',
      rationale:
        'A client pinned to an older revision reads a newer answer as "server does not speak my version".',
      sources: [SPEC_LIFECYCLE],
      params: { revisions: ['2025-03-26', '2025-06-18', '2025-11-25'] },
    },
    {
      check: 'initialize-unsupported-version-fallback',
      confidence: 'documented',
      rationale:
        'The legacy spec makes the client decide whether it can live with the offered revision; erroring removes that choice.',
      sources: [SPEC_LIFECYCLE],
    },
    {
      check: 'initialize-never-echoes-modern-revision',
      confidence: 'documented',
      rationale:
        'SDK 1.x hard-throws on a revision outside its own list, and 2026-07-28 is not in it. Every mcp-remote user is an SDK 1.x user.',
      sources: [SDK_TS_TYPES, SDK_TS_CLIENT, SDK_PY_SESSION],
    },
    {
      check: 'initialize-server-info',
      confidence: 'documented',
      rationale: 'The server MUST respond with its own capabilities and information.',
      sources: [SPEC_LIFECYCLE],
    },
    {
      check: 'initialize-declares-tools-capability',
      confidence: 'documented',
      rationale:
        'The SDK asserts the capability before dispatching the method, so an undeclared tools capability means tools/list is never called.',
      sources: [SDK_TS_CLIENT],
    },
    {
      check: 'notification-ack-202',
      confidence: 'observed',
      rationale:
        'Answering a notification with a JSON-RPC body is what a shipping Claude Desktop bridge had to work around; the Python SDK raises INVALID_REQUEST on it.',
      sources: [MCPB_RELAY, SPEC_TRANSPORT],
    },
    {
      check: 'response-content-type',
      confidence: 'documented',
      rationale:
        'Both official SDKs throw an unrecoverable transport error on any other media type, so an HTML error page terminates the session instead of surfacing as a server error.',
      sources: [SDK_TS_TRANSPORT, SPEC_TRANSPORT],
    },
    {
      check: 'tools-list-shape',
      confidence: 'documented',
      rationale: 'A malformed descriptor makes a validating client drop the whole catalog.',
      sources: [
        {
          kind: 'spec',
          url: 'https://modelcontextprotocol.io/specification/2025-06-18/server/tools',
          retrieved: RETRIEVED,
          note: 'Tool descriptor shape: name, description, inputSchema.',
        },
      ],
    },
    {
      check: 'resources-list-shape',
      confidence: 'documented',
      rationale:
        'A server with no resources returns an empty array; erroring is indistinguishable from an unhealthy server.',
      sources: [
        {
          kind: 'spec',
          url: 'https://modelcontextprotocol.io/specification/2025-06-18/server/resources',
          retrieved: RETRIEVED,
        },
      ],
    },
    {
      check: 'unknown-method-error-code',
      confidence: 'documented',
      rationale: 'A 5xx makes a client retry and then mark the server unhealthy; -32601 is reported and moved past.',
      sources: [
        {
          kind: 'spec',
          url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic',
          retrieved: RETRIEVED,
          note: 'JSON-RPC 2.0 error semantics: -32601 Method not found.',
        },
      ],
    },
    {
      check: 'sse-get-stream',
      confidence: 'documented',
      rationale:
        'The SDK opens GET after the initialized notification and swallows a 405. Anything else - a 200 HTML page, a 5xx - is a transport error.',
      sources: [SPEC_TRANSPORT, SDK_TS_TRANSPORT],
    },
    {
      check: 'delete-method-handled',
      confidence: 'documented',
      rationale:
        'The SDK calls DELETE on shutdown and treats 405 as "server does not allow clients to terminate sessions". A 5xx surfaces as a disconnect error on every close.',
      sources: [SPEC_TRANSPORT, SDK_TS_TRANSPORT],
    },
    {
      check: 'session-header-absent-or-echoed',
      confidence: 'documented',
      rationale:
        'Stateless is fine; minting a session id and then rejecting it leaves the client with no way back.',
      sources: [SPEC_TRANSPORT],
    },
    {
      check: 'protocol-version-header-tolerated',
      confidence: 'documented',
      rationale:
        'Clients on 2025-06-18 and later are required to send MCP-Protocol-Version on every post-initialize request.',
      sources: [
        {
          kind: 'spec',
          url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports',
          retrieved: RETRIEVED,
          note: 'Protocol Version Header: clients MUST include MCP-Protocol-Version on subsequent requests.',
        },
      ],
    },
    {
      check: 'tools-list-deterministic-order',
      confidence: 'inferred',
      rationale:
        'A spec SHOULD rather than a MUST; carried as advisory because no surveyed client is known to fail on an unstable order.',
      sources: [
        {
          kind: 'repo',
          ref: 'docs/dual-era-policy.md server checklist item 7',
          note: 'Deterministic tool ordering, also for prompt-cache hits.',
        },
      ],
    },
  ],
  quirks: [
    {
      note: 'mcp-remote defaults to http-first and falls back to the deprecated HTTP+SSE pair transport on a 404. A server that 404s a POST to its MCP path will be silently re-probed as a 2024-11-05 server rather than reported as misconfigured.',
      sources: [{ kind: 'doc', url: 'https://github.com/geelen/mcp-remote', retrieved: RETRIEVED }],
      confidence: 'documented',
    },
    {
      note: 'SDK 1.x accepts a downgraded echo silently and sticks to it: ask for 2025-11-25, get 2025-06-18, and every later request is stamped 2025-06-18. A server that downgrades on purpose gets no error, just an older client.',
      sources: [SDK_TS_CLIENT],
      confidence: 'documented',
    },
    {
      note: 'The MCP Apps UI extension is a separate specification (extension protocol version 2026-01-26) with its own resource media type text/html;profile=mcp-app and a _meta.ui.resourceUri link from the tool. It is not part of the core revision.',
      sources: [
        {
          kind: 'spec',
          url: 'https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx',
          retrieved: RETRIEVED,
        },
      ],
      confidence: 'documented',
    },
  ],
  unknowns: [
    {
      question:
        'Does the TypeScript SDK 1.x auth module try the three-URL authorization-server metadata order the 2026-07-28 spec mandates (oauth-authorization-server{path}, openid-configuration{path}, {path}/openid-configuration)?',
      experiment:
        'Read packages/client auth.ts on the v1.x branch, or run mcp-remote against a server that serves each variant in isolation and log which paths are requested, in order.',
      impact:
        'Decides whether as-metadata-both-paths is sufficient for SDK clients or whether the OIDC variants must be served too.',
    },
    {
      question: 'What are the exact literal values of the Python SDK HANDSHAKE_PROTOCOL_VERSIONS set?',
      experiment:
        'Read src/mcp/types/__init__.py in the python-sdk repo (it re-exports from an external mcp_types package), or connect the Python client to a probe server that echoes an out-of-set revision and read the RuntimeError message.',
      impact:
        'The profile currently assumes the same set as TypeScript 1.x. If Python is narrower, initialize-version-echo needs a Python-specific revision list.',
    },
  ],
  disagreements: [
    {
      topic: 'Whether a server must answer 406 when the client Accept header omits text/event-stream',
      positions: [
        'packages/connect/src/mcp-client.ts carries a comment asserting spec-conformant servers answer 406.',
        'No revision of the transport specification mandates 406 for a missing or partial Accept header.',
      ],
      resolution:
        'Not carried as a requirement. Sending both media types is a client MUST; demanding a specific rejection status from the server is not in any revision, so encoding it would invent a requirement.',
    },
  ],
}
