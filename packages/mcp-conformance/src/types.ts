/**
 * Types for the MCP client-conformance registry.
 *
 * The registry exists because MCP compatibility knowledge tends to live as
 * prose (`docs/evidence/grok-connector.md`, `docs/dual-era-policy.md`) and as
 * scar tissue from debugging sessions. Prose does not regress-test. Everything
 * here is written so a client requirement is a typed record with a citation and
 * an executable check, and so an unsourced belief can never gate CI.
 */

/**
 * How strongly a requirement is established.
 *
 * - `observed`  - we watched a real client do this (a captured log, a recorded
 *   transcript). The strongest evidence, and the only kind that beats a doc
 *   when the two disagree.
 * - `documented` - the vendor or the MCP specification says so, at a URL we
 *   fetched on a recorded date.
 * - `inferred`  - reasoned from adjacent facts. **Never gates.** An inferred
 *   requirement is reported as advisory so a failure is visible without
 *   turning a guess into a build break.
 */
export type Confidence = 'observed' | 'documented' | 'inferred'

/** A single piece of evidence behind one assertion. */
export interface Citation {
  kind: 'doc' | 'spec' | 'observed' | 'repo'
  /** Documentation or specification URL, for `doc` / `spec`. */
  url?: string
  /**
   * Where the observation or code lives: `docs/evidence/grok-connector.md section 5`
   * for `observed`, `path/to/file.ts:123` for `repo`.
   */
  ref?: string
  /** ISO date the URL was retrieved or the observation was made. */
  retrieved?: string
  /** One line of detail: what exactly this source says. */
  note?: string
}

/** Identifier of an executable check. The registry's vocabulary of requirements. */
export type CheckId =
  // --- legacy lifecycle -------------------------------------------------
  | 'initialize-version-echo'
  | 'initialize-unsupported-version-fallback'
  | 'initialize-server-info'
  | 'initialize-declares-tools-capability'
  | 'initialize-never-echoes-modern-revision'
  | 'notification-ack-202'
  | 'tools-list-shape'
  | 'tools-list-deterministic-order'
  | 'resources-list-shape'
  | 'protocol-version-header-tolerated'
  | 'unknown-method-error-code'
  // --- modern (2026-07-28) era -----------------------------------------
  | 'server-discover'
  | 'modern-result-type'
  | 'modern-cache-hints'
  | 'modern-unsupported-version-rejected'
  | 'legacy-ignores-modern-headers'
  // --- transport --------------------------------------------------------
  | 'response-content-type'
  | 'sse-get-stream'
  | 'delete-method-handled'
  | 'session-header-absent-or-echoed'
  // --- auth / discovery -------------------------------------------------
  | 'unauthenticated-401-challenge'
  | 'prm-document-served'
  | 'as-metadata-both-paths'
  | 'as-metadata-no-cross-origin-redirect'
  | 'as-metadata-pkce-s256'
  // --- CORS -------------------------------------------------------------
  | 'cors-preflight'
  | 'cors-allowed-headers'
  | 'cors-exposed-headers'
  // --- catalog shape ----------------------------------------------------
  | 'tool-name-limit'
  | 'tool-description-limit'
  | 'tool-count-limit'
  | 'mcp-apps-ui-extension'
  | 'tool-annotations-present'
  | 'mcp-apps-ui-resource-resolvable'
  | 'mcp-apps-widget-mime-type'
  | 'deep-research-search-fetch-contract'

/** A requirement one client places on a server, with its evidence. */
export interface Requirement {
  check: CheckId
  confidence: Confidence
  /** Why this client needs it. One line, concrete. */
  rationale: string
  /** At least one citation, always. A requirement with none cannot be `documented` or `observed`. */
  sources: Citation[]
  /** Parameters for a parameterized check (limits, revision lists). */
  params?: CheckParams
  /**
   * True when proving this needs a live third-party client (a real Grok OAuth
   * popup, a claude.ai connector add). Rendered as a runbook step by the
   * reporter; never executed and never a CI gate.
   */
  manual?: boolean
}

/** Parameters a check may read. Every field optional; each check documents what it uses. */
export interface CheckParams {
  /** Protocol revisions the client may open with, for `initialize-version-echo`. */
  revisions?: readonly string[]
  /** Max tool-name length, for `tool-name-limit`. */
  maxToolNameLength?: number
  /** Allowed tool-name character class, as a source-side regexp string. */
  toolNamePattern?: string
  /** Max tool-description length, for `tool-description-limit`. */
  maxToolDescriptionLength?: number
  /** Max number of tools the client will accept, for `tool-count-limit`. */
  maxToolCount?: number
  /** Request headers that must appear in `Access-Control-Allow-Headers`. */
  requiredAllowedHeaders?: readonly string[]
  /** Response headers that must appear in `Access-Control-Expose-Headers`. */
  requiredExposedHeaders?: readonly string[]
  /** Revision string used to probe the modern era. */
  modernRevision?: string
}

/** How a client authenticates against a server. */
export type AuthStrategy =
  /** OAuth 2.1 + PKCE with RFC 7591 dynamic client registration. */
  | 'oauth-dcr'
  /** OAuth 2.1 + PKCE against a client id the operator registers by hand. */
  | 'oauth-manual-client'
  /** A long-lived credential the operator pastes, sent as `Authorization: Bearer`. */
  | 'static-bearer'
  /** Arbitrary operator-supplied headers. */
  | 'custom-headers'
  /** No credential. */
  | 'none'

/** Transport a client speaks. */
export type Transport =
  /** Streamable HTTP, responses on the POST itself (2025-03-26 onward). */
  | 'streamable-http'
  /** Streamable HTTP where the client also opens `GET` for a server-initiated stream. */
  | 'streamable-http-sse'
  /** The deprecated 2024-11-05 HTTP+SSE pair transport. */
  | 'http-sse-pair'

/** One step of the HTTP sequence a client performs on a fresh connect. */
export interface DiscoveryStep {
  method: string
  /** Path or absolute URL, as the client requests it. */
  path: string
  /** What the client does with the answer, and what a failure costs. */
  note: string
  sources: Citation[]
  confidence: Confidence
}

/** A behavior we could not source, and how to settle it. */
export interface Unknown {
  question: string
  /** A concrete procedure that would resolve it. */
  experiment: string
  /** What we would do differently depending on the answer. */
  impact?: string
}

/** A place two sources disagreed, recorded rather than silently resolved. */
export interface Disagreement {
  topic: string
  positions: string[]
  /** Which we took and why. Observed beats documented beats inferred. */
  resolution: string
}

/** Everything known about one real MCP client. */
export interface ClientProfile {
  /** Stable machine id, kebab-case. Used in reports and CI output. */
  id: string
  displayName: string
  vendor: string
  /** One paragraph: what this client is and how a user points it at a server. */
  summary: string
  /**
   * Revisions this client is known to send or accept, newest-first. An empty
   * list means we could not source any; the profile must then say so in
   * `unknowns` rather than guessing.
   */
  acceptedProtocolRevisions: readonly string[]
  /** True when the client is known to reach the modern 2026-07-28 stateless era. */
  supportsModernEra: boolean
  transports: readonly Transport[]
  authStrategies: readonly AuthStrategy[]
  /** Ordered HTTP requests on a fresh connect, where we can source them. */
  discoverySequence: readonly DiscoveryStep[]
  /** The executable requirements. This is what the runner runs. */
  requirements: readonly Requirement[]
  /** Behaviors that bite in practice but are not expressible as a server check. */
  quirks: readonly { note: string; sources: Citation[]; confidence: Confidence }[]
  unknowns: readonly Unknown[]
  disagreements?: readonly Disagreement[]
}

// --- check execution ----------------------------------------------------

export type CheckStatus = 'pass' | 'fail' | 'skip'

/** A recorded HTTP exchange, kept as the evidence behind a check result. */
export interface Exchange {
  request: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
  }
  response:
    | { status: number; headers: Record<string, string>; body?: string }
    | { error: string }
}

export interface CheckResult {
  check: CheckId
  status: CheckStatus
  /** One line: what happened. On `fail`, what was expected and what came back. */
  detail: string
  /** The exchanges that produced this verdict. */
  evidence: Exchange[]
  /** Present on `fail`: what to change on the server. */
  remediation?: string
  /**
   * Set when the check itself threw rather than reaching a verdict - a bug in
   * the check, not a fact about the server. Reported as a `skip` so it is never
   * counted as a failure, but tracked separately so it can never be counted as
   * a pass either: a profile with an errored gating check is `unproven`.
   */
  executionError?: string
}

/** A check implementation. */
export interface Check {
  id: CheckId
  /** Short human title for reports. */
  title: string
  /** What a passing server does, in one sentence. */
  requirement: string
  run(ctx: CheckContext): Promise<CheckResult>
}

/** Fetch shaped so an in-process handler can stand in for the network. */
export type FetchLike = (request: Request) => Promise<Response>

/** An MCP endpoint under test - live over HTTP, or a handler driven in-process. */
export interface ConformanceTarget {
  /** Stable machine id, kebab-case: `website-mcp`, `hosted-runtime-ts`. */
  id: string
  displayName: string
  /**
   * Absolute URL of the MCP endpoint. For in-process targets this is a
   * plausible stand-in (`https://mcp.example.com/mcp`); checks derive `.well-known`
   * paths and the expected `Origin` from it, and it appears in evidence.
   */
  url: string
  /** Credential presented as `Authorization: Bearer <credential>`, when the surface needs one. */
  credential?: string | null
  /** Endpoint fetcher. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike
  /**
   * Fetcher for discovery documents, including absolute authorization-server
   * URLs advertised by protected-resource metadata. Defaults to `fetch`.
   * Network callers should supply the same SSRF-guarded transport used for the
   * endpoint; in-process targets supply a router for their synthetic origins.
   */
  originFetch?: FetchLike
  /**
   * Checks this target genuinely cannot answer, mapped to the reason. The
   * reason is printed, so a skip is always accounted for rather than silent.
   * Use it for real structural facts ("in-process handler owns no origin"),
   * never to paper over a failure.
   */
  notApplicable?: Partial<Record<CheckId, string>>
}

/** What a check is handed. */
export interface CheckContext {
  target: ConformanceTarget
  /** The requirement being evaluated, so a check can read `params`. */
  requirement: Requirement
  /** The profile asking, for messages. */
  profile: ClientProfile
  /** Send a request to the MCP endpoint, recording the exchange. */
  send(init: ProbeInit): Promise<ProbeResult>
  /** Send a request to a discovery path or absolute issuer URL, recording the exchange. */
  sendOrigin(path: string, init?: ProbeInit): Promise<ProbeResult>
  /** Convenience: a JSON-RPC request against the endpoint. */
  rpc(method: string, params?: unknown, init?: Partial<ProbeInit>): Promise<ProbeResult>
  /** A JSON-RPC notification (no `id`), which the transport must answer 202 with no body. */
  notify(method: string, params?: unknown, init?: Partial<ProbeInit>): Promise<ProbeResult>
  /** Every exchange recorded so far in this check. */
  evidence(): Exchange[]
  pass(detail: string): CheckResult
  fail(detail: string, remediation: string): CheckResult
  skip(detail: string): CheckResult
}

export interface ProbeInit {
  method?: string
  /** Path or absolute URL. Relative values resolve against the target URL. */
  path?: string
  headers?: Record<string, string>
  body?: string
  /** Send no `Authorization` header even when the target has a credential. */
  anonymous?: boolean
  /** Do not follow redirects; report the 3xx itself. Default for discovery checks. */
  manualRedirect?: boolean
}

export interface ProbeResult {
  ok: boolean
  status: number
  headers: Headers
  text: string
  /** Parsed body when the response was JSON; `undefined` otherwise. */
  json?: unknown
  /** Set when the request itself threw (network error, handler exception). */
  error?: string
}
