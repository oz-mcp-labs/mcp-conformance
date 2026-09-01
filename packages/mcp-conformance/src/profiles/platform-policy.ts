/**
 * Your own normative policy, expressed as a profile. **This is the file to
 * edit** - it is the template's worked example of house rules that are not any
 * vendor's requirement.
 *
 * This is not a client. It is `docs/dual-era-policy.md` - a standing rule set
 * for every MCP surface in the repo - turned into executable checks, so that
 * "a PR touching any MCP surface is checked against this document" stops being
 * a review step someone has to remember.
 *
 * It lives as a profile rather than a separate mechanism for one reason: the
 * runner already knows how to say "surface X satisfies requirement set Y, and
 * here is the wire evidence". A policy is a requirement set. Treating it as
 * one client among many also keeps the honest ordering visible in a report - a
 * surface can pass every real client and still fail a forward-looking policy of
 * your own, which is the state most surfaces are in when this profile is first
 * switched on.
 *
 * The CORS requirements live here, and only here, for a specific reason: **no
 * vendor client requires CORS on the MCP endpoint.** Claude, ChatGPT, and Grok
 * all reach it from their own backends. Attaching CORS to those profiles would
 * be inventing a vendor requirement. It is nonetheless a real requirement for
 * anyone whose policy mandates it, and for browser-resident clients.
 */

import type { Citation, ClientProfile } from '../types.ts'

const POLICY = (section: string, note: string): Citation => ({
  kind: 'repo',
  ref: `docs/dual-era-policy.md ${section}`,
  note,
})

const MIGRATION: Citation = {
  kind: 'repo',
  ref: 'docs/dual-era-policy.md (background)',
  note: 'Background assessment and retrofit sequencing for the 2026-07-28 revision.',
}

const OBSERVED_GATEWAY_DISCOVER: Citation = {
  kind: 'observed',
  ref: 'Cloudflare Workers Logs, MCP gateway service, req_f790aa42a6a061ab',
  retrieved: '2026-08-27',
  note: 'mcp_request methods=["server/discover"] protocolVersion=2026-07-28 status=400 - a real modern-era client called server/discover on a production gateway and was rejected. Not a doc claim: a captured production request.',
}

export const platformPolicyProfile: ClientProfile = {
  id: 'example-platform-policy',
  displayName: 'Example dual-era platform policy',
  vendor: 'Example Platform',
  summary:
    'The repo standing rule that every MCP surface is dual-era: the 2026-07-28 revision as primary target, the legacy revisions as fallback, with the CORS allow-lists, MCP Apps declaration, and deterministic ordering the policy checklist requires. Not a client - a policy, made executable so a surface cannot drift back to legacy-only without a test going red.',
  acceptedProtocolRevisions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'],
  supportsModernEra: true,
  transports: ['streamable-http'],
  authStrategies: ['oauth-dcr', 'static-bearer', 'none'],
  discoverySequence: [],
  requirements: [
    {
      check: 'server-discover',
      confidence: 'observed',
      rationale:
        'Checklist item 3. A real 2026-07-28 client has already called server/discover against a production surface and been rejected, so this is not forward-looking - it is a live gap.',
      sources: [
        POLICY('server checklist item 3', 'server/discover returns supported versions, capabilities, identity; protocolVersions lists every revision the surface speaks, newest first, across both eras.'),
        OBSERVED_GATEWAY_DISCOVER,
      ],
    },
    {
      check: 'modern-result-type',
      confidence: 'documented',
      rationale: 'Checklist item 4: resultType on every result, plus _meta serverInfo on the modern path.',
      sources: [POLICY('server checklist item 4', 'resultType "complete" on every result, or "input_required" where MRTR applies.')],
    },
    {
      check: 'modern-cache-hints',
      confidence: 'documented',
      rationale:
        'Checklist item 4: ttlMs and cacheScope on the five list/read methods. Without them a stateless client re-lists every turn, which is the cost the modern era exists to remove.',
      sources: [POLICY('server checklist item 4', 'ttlMs + cacheScope on the five list/read methods.')],
    },
    {
      check: 'modern-unsupported-version-rejected',
      confidence: 'documented',
      rationale:
        'A modern version the surface does not support is answered -32022 with a supported list, never silently downgraded - the one outcome the spec forbids. Compare lexicographically on the raw string so an unparseable marker lands in the modern branch rather than quietly receiving a legacy response.',
      sources: [
        POLICY('Era detection', 'Compare version markers lexicographically on the raw string, without first gating on a YYYY-MM-DD shape. Shape-gating is how one runtime silently downgraded MCP-Protocol-Version: banana while its sibling rejected it.'),
      ],
    },
    {
      check: 'legacy-ignores-modern-headers',
      confidence: 'documented',
      rationale:
        'Checklist item 2: gate the Mcp-Method / Mcp-Name mismatch check on the detected era. Running it era-agnostically is what made "legacy behavior is byte-identical" untrue.',
      sources: [POLICY('server checklist item 2', 'Header/body validation is modern-only and must be gated on the detected era; -32020 is a code no legacy client can interpret.')],
    },
    {
      check: 'initialize-never-echoes-modern-revision',
      confidence: 'documented',
      rationale:
        'Do not add 2026-07-28 to the legacy echo set. initialize is always a legacy request; reaching the modern era is server/discover or a modern version marker, never initialize.',
      sources: [POLICY('initialize cannot reach the modern era, by design', 'A hybrid client that opens with initialize therefore cannot reach the modern era.')],
    },
    {
      check: 'initialize-version-echo',
      confidence: 'documented',
      rationale: 'Checklist item 5: legacy lifecycle intact - initialize echoes the requested revision when supported.',
      sources: [POLICY('server checklist item 5', 'initialize echoes the requested revision when supported, notifications get 202, session-id echo preserved.')],
      params: { revisions: ['2025-03-26', '2025-06-18', '2025-11-25'] },
    },
    {
      check: 'notification-ack-202',
      confidence: 'documented',
      rationale:
        'Checklist item 5: the legacy lifecycle stays intact, and notifications get 202 with no body. This is one of the two bugs that kept a real connector from attaching.',
      sources: [POLICY('server checklist item 5', 'Notifications get 202.')],
    },
    {
      check: 'mcp-apps-ui-extension',
      confidence: 'documented',
      rationale:
        'Checklist item 6: advertise extensions io.modelcontextprotocol/ui on both paths. Gating _meta.ui unconditionally is what makes widgets vanish for every current client.',
      sources: [POLICY('server checklist item 6', 'Advertise extensions: { "io.modelcontextprotocol/ui": {} } on both paths.')],
    },
    {
      check: 'tools-list-deterministic-order',
      confidence: 'documented',
      rationale: 'Checklist item 7, a spec SHOULD that also improves prompt-cache hits.',
      sources: [POLICY('server checklist item 7', 'Deterministic tool ordering in tools/list.')],
    },
    {
      check: 'cors-preflight',
      confidence: 'documented',
      rationale: 'Checklist item 1. Required by policy for every surface, not by any vendor client.',
      sources: [POLICY('server checklist item 1', 'CORS allow-lists include MCP-Protocol-Version, Mcp-Method, and Mcp-Name alongside the legacy headers, and keep mcp-session-id until legacy retirement.')],
    },
    {
      check: 'cors-allowed-headers',
      confidence: 'documented',
      rationale:
        'Checklist item 1. Access-Control-Allow-Headers matches literal names, so a wildcard does not cover Authorization and Mcp-Param-* is not expanded.',
      sources: [POLICY('server checklist item 1', 'Enumerate the concrete names or reflect them from Access-Control-Request-Headers.')],
    },
    {
      check: 'unknown-method-error-code',
      confidence: 'documented',
      rationale:
        'A method the surface does not implement answers -32601, like any other unimplemented method. The policy states this for subscriptions/listen and it generalises.',
      sources: [POLICY('Era detection', 'A stateless surface that declares resources: { subscribe: false, listChanged: false } has nothing to stream and answers -32601, like any other method it does not implement.')],
    },
    {
      check: 'cors-exposed-headers',
      confidence: 'inferred',
      rationale:
        'The policy says keep mcp-session-id until legacy retirement, but does not name Access-Control-Expose-Headers explicitly. Advisory: adjust the required list to whatever your own clients read back.',
      sources: [POLICY('server checklist item 1', 'Keep mcp-session-id until legacy retirement.'), MIGRATION],
      params: { requiredExposedHeaders: ['mcp-session-id'] },
    },
  ],
  quirks: [
    {
      note: 'Modern-only is forbidden and legacy-only is a policy violation for new work. A brand-new surface ships dual-era from its first commit; an existing legacy-only surface gains the modern path when touched.',
      sources: [POLICY('The rule', 'Modern-only is forbidden. Legacy-only is a policy violation for new work.')],
      confidence: 'documented',
    },
    {
      note: 'Share the dual-era plumbing through one module rather than hand-rolling it per surface. Two copies of a route whose authorization tables silently drifted apart is the cautionary precedent this rule exists for.',
      sources: [POLICY('server checklist', 'Prefer sharing the dual-era plumbing through a single protocol module.')],
      confidence: 'documented',
    },
    {
      note: 'What users inherit must be era-correct: anything bundled into a user artifact at build time is frozen there, so a stale template propagates further than a stale server.',
      sources: [POLICY('What users inherit must be era-correct', 'Runtimes, scaffolds, examples, agent skills, and the .well-known documents all fall under this policy.')],
      confidence: 'documented',
    },
    {
      note: '2024-11-05 stays unsupported everywhere. That revision transport is the legacy HTTP+SSE pair, where responses arrive on a separately opened channel; these handlers answer on the POST itself, so claiming it would report a successful negotiation and then strand the client.',
      sources: [POLICY('The rule', '2024-11-05 (HTTP+SSE pair transport) stays unsupported everywhere, as today.')],
      confidence: 'documented',
    },
  ],
  unknowns: [
    {
      question:
        'Should sibling MCP routes in one codebase adopt a shared dual-era module, or should one become a thin adapter over the other?',
      experiment:
        'Extract the era detection, modern result stamping, header/body mismatch check, cache metadata and advertised revision list into one protocol module, wire a single route to it, and measure the diff. A runtime that ships inside user bundles keeps its own local copy by design.',
      impact:
        'Decides whether sibling routes converge or stay hand-maintained copies. Drift between two copies of one surface is measurable and invisible until something imports both.',
    },
  ],
}
