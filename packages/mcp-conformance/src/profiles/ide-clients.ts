/**
 * IDE and editor MCP clients: Cursor, VS Code with GitHub Copilot, and Zed.
 *
 * These are grouped because they share a shape - a developer pastes a URL into
 * a JSON config, optionally with static headers - and because, individually,
 * almost nothing about their wire behavior is documented. Publishing three
 * profiles that each carry two facts and eight unknowns would overstate what we
 * know. One profile with the sourced facts and an explicit unknowns list is the
 * honest form.
 *
 * The consequence is that this profile gates on very little. That is correct:
 * the sourced requirements are the ones that would actually break these
 * clients, and the rest belongs in `unknowns` until somebody runs the probe.
 */

import type { Citation, ClientProfile } from '../types.ts'

const RETRIEVED = '2026-08-28'

const CURSOR: Citation = {
  kind: 'doc',
  url: 'https://cursor.com/docs/context/mcp',
  retrieved: RETRIEVED,
  note: 'Remote transports: SSE and Streamable HTTP. Config keys url, headers, and an auth object. Static OAuth client credentials may be provided in mcp.json instead of dynamic client registration - DCR is not supported.',
}

const VSCODE: Citation = {
  kind: 'doc',
  url: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration',
  retrieved: RETRIEVED,
  note: 'Server types stdio, http, sse. For sse VS Code first tries the HTTP Stream transport and falls back to SSE. HTTP fields: type, url, optional headers, optional oauth with a required clientId.',
}

const VSCODE_FEATURES: Citation = {
  kind: 'doc',
  url: 'https://code.visualstudio.com/docs/copilot/customization/mcp-servers',
  retrieved: RETRIEVED,
  note: 'Consumes tools, prompts, resources, and interactive apps.',
}

const VSCODE_TOOL_LIMIT: Citation = {
  kind: 'doc',
  url: 'https://github.com/microsoft/vscode-copilot-release/issues/11653',
  retrieved: RETRIEVED,
  note: 'A 128-tool-per-request limit enforced at request time, with built-in extension tools counting toward it; over-threshold MCP tools are deferred behind activate_* virtual tools. Issue-tracker evidence, not the reference documentation.',
}

const ZED: Citation = {
  kind: 'doc',
  url: 'https://zed.dev/docs/ai/mcp',
  retrieved: RETRIEVED,
  note: 'Remote servers configured with url plus optional headers. When a remote server has no configured Authorization header, Zed prompts the user to authenticate with the standard MCP OAuth flow.',
}

const SPEC_TRANSPORT: Citation = {
  kind: 'spec',
  url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports',
  retrieved: RETRIEVED,
}

export const ideClientsProfile: ClientProfile = {
  id: 'ide-remote-clients',
  displayName: 'IDE clients (Cursor, VS Code Copilot, Zed)',
  vendor: 'various',
  summary:
    'Editor-resident MCP clients configured by pasting a URL into a JSON file. All three support remote HTTP servers with optional static headers; VS Code and Zed additionally run an OAuth flow, and Cursor supports only pre-registered OAuth client credentials, not dynamic registration. Very little of their wire behavior is published, so this profile gates on the small sourced core and records the rest as unknowns rather than guessing.',
  acceptedProtocolRevisions: [],
  supportsModernEra: false,
  transports: ['streamable-http', 'http-sse-pair'],
  authStrategies: ['oauth-manual-client', 'oauth-dcr', 'static-bearer', 'custom-headers', 'none'],
  discoverySequence: [],
  requirements: [
    {
      check: 'initialize-version-echo',
      confidence: 'inferred',
      rationale:
        'All three are almost certainly SDK-based, but none documents a revision. Carried as advisory so a mismatch is visible without a guess gating CI.',
      sources: [CURSOR, VSCODE, ZED],
      params: { revisions: ['2025-03-26', '2025-06-18', '2025-11-25'] },
    },
    {
      check: 'response-content-type',
      confidence: 'documented',
      rationale:
        'VS Code probes the HTTP Stream transport and falls back to SSE, so the response framing decides which transport it settles on.',
      sources: [VSCODE, SPEC_TRANSPORT],
    },
    {
      check: 'notification-ack-202',
      confidence: 'documented',
      rationale: 'Streamable HTTP transport requirement, shared by every client that speaks it.',
      sources: [SPEC_TRANSPORT],
    },
    {
      check: 'tools-list-shape',
      confidence: 'documented',
      rationale: 'All three consume the tool catalog; VS Code also consumes prompts, resources, and interactive apps.',
      sources: [VSCODE_FEATURES, CURSOR, ZED],
    },
    {
      check: 'resources-list-shape',
      confidence: 'documented',
      rationale: 'VS Code documents resources as a consumed feature.',
      sources: [VSCODE_FEATURES],
    },
    {
      check: 'unauthenticated-401-challenge',
      confidence: 'documented',
      rationale:
        'Zed starts the standard MCP OAuth flow when no Authorization header is configured, which begins at the challenge.',
      sources: [ZED],
    },
    {
      check: 'tool-count-limit',
      confidence: 'inferred',
      rationale:
        'VS Code enforces 128 tools per request, with built-in tools counting toward the budget - but the evidence is the issue tracker, not the reference documentation, so it is advisory. It is nonetheless the tightest published ceiling of any surveyed client and worth watching.',
      sources: [VSCODE_TOOL_LIMIT],
      params: { maxToolCount: 128 },
    },
  ],
  quirks: [
    {
      note: 'Cursor does not support dynamic client registration: an authorization server that only offers DCR cannot be used from Cursor without the operator pre-registering a client and pasting the id.',
      sources: [CURSOR],
      confidence: 'documented',
    },
    {
      note: 'VS Code deferring over-threshold tools behind activate_* stubs means a large catalog degrades rather than fails - the tools are still reachable, but the model must discover them through a stub first.',
      sources: [VSCODE_TOOL_LIMIT],
      confidence: 'documented',
    },
  ],
  unknowns: [
    {
      question:
        'What protocol revision does each of Cursor, VS Code, and Zed send, and do they send MCP-Protocol-Version on post-initialize requests?',
      experiment:
        'One probe server logging the raw initialize body and every header, added to all three editors in turn. A single afternoon closes this for all three.',
      impact:
        'Every revision requirement on this profile is inferred today. This experiment would make them gating for a client family many users actually use.',
    },
    {
      question: 'Do any of the three handle RFC 9728 protected resource metadata, and in what path order?',
      experiment: 'Serve the PRM at one variant at a time and log which paths each editor requests.',
      impact: 'Decides whether prm-document-served belongs on this profile.',
    },
    {
      question: 'Does VS Code sse-to-http probing key on the status code or on the response content type?',
      experiment: 'Answer the probe with a 405, a 404, and a 200 of the wrong media type, and see which selects SSE.',
      impact:
        'Relevant because mcp-remote is documented to fall back to the deprecated pair transport on a 404; if VS Code does the same, a 404 on the MCP path is worse than a 405 in two clients rather than one.',
    },
    {
      question: 'Is the VS Code 128-tool ceiling real and current?',
      experiment: 'Expose 120 and 200 tools and count what reaches the model, with and without other extensions active.',
      impact:
        'A 76-tool catalogue is already in production against these clients. If 128 is real and built-in tools count toward it, a user with other MCP servers configured is already close.',
    },
  ],
}
