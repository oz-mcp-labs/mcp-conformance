/**
 * The single MCP client in this package.
 *
 * Every check drives the target through this one probe, and every request and
 * response it makes is recorded as `Exchange` evidence. That is deliberate: a
 * conformance report whose failures you cannot read the wire bytes for is a
 * claim, not proof, and the whole point of the registry is that a customer or
 * a CI log can see what actually happened.
 *
 * The probe is transport-agnostic - it calls a `FetchLike`, so an in-process
 * Next.js route handler, a Worker `fetch`, or the global `fetch` against a live
 * endpoint are all the same thing to it. That is what lets the suite run
 * offline in CI and against production with identical checks.
 */

import type {
  CheckContext,
  CheckId,
  CheckResult,
  ClientProfile,
  ConformanceTarget,
  Exchange,
  FetchLike,
  ProbeInit,
  ProbeResult,
  Requirement,
} from './types.ts'

/** Evidence bodies are truncated at this many characters. Enough to see the shape. */
const MAX_EVIDENCE_BODY = 2000

/** Headers we never echo into evidence, so a report is safe to hand to a customer. */
const REDACTED_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization'])

function snapshotHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? '<redacted>' : value
  })
  return out
}

function truncate(body: string): string {
  return body.length > MAX_EVIDENCE_BODY ? `${body.slice(0, MAX_EVIDENCE_BODY)}...[truncated]` : body
}

/**
 * `Response.redirect`-style following is exactly what we must NOT do by default
 * for discovery checks: Grok refused to follow a cross-origin 308 for
 * authorization-server metadata, and a probe that follows redirects reports the
 * followed document as if the client had accepted it
 * (docs/evidence/grok-connector.md section 5).
 */
const DEFAULT_REDIRECT: RequestRedirect = 'manual'

/** Body-read budget for a non-streaming response, in milliseconds. */
const BODY_READ_TIMEOUT_MS = 15_000

/** Placeholder recorded in place of a body the probe deliberately did not read. */
const UNCONSUMED_SSE = '<text/event-stream: open stream, body not consumed>'

/**
 * Read a response body without ever hanging on a stream that stays open.
 *
 * An SSE response is open by design - the website MCP route holds it with a
 * 30-second keep-alive ping - so `response.text()` on it never resolves and
 * every check in the run stalls until the test timeout. The probe therefore
 * cancels a `text/event-stream` body unread: the status and headers are what
 * the SSE check actually asserts on. The timeout is the backstop for anything
 * else that streams without saying so.
 */
async function readBody(response: Response): Promise<string> {
  const media = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
  if (media === 'text/event-stream') {
    await response.body?.cancel().catch(() => undefined)
    return UNCONSUMED_SSE
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      response.text(),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => {
          void response.body?.cancel().catch(() => undefined)
          resolve('<body read timed out>')
        }, BODY_READ_TIMEOUT_MS)
      }),
    ])
  } catch {
    // A body already consumed or a transport error mid-read; the status and
    // headers still count.
    return ''
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Version markers at or above this belong to the modern, stateless era. */
const MODERN_FLOOR = '2026-07-28'

export class Probe implements CheckContext {
  private readonly exchanges: Exchange[] = []
  private readonly endpointFetch: FetchLike
  private readonly originFetcher: FetchLike
  /**
   * Session id minted by a legacy `initialize`, once one has been performed.
   * `null` means the handshake ran and the server minted nothing (stateless,
   * which is the common case and perfectly valid); `undefined` means it has
   * not run yet.
   */
  private legacySessionId: string | null | undefined
  /** Guards against a handshake recursing into itself. */
  private handshaking = false

  constructor(
    readonly target: ConformanceTarget,
    readonly requirement: Requirement,
    readonly profile: ClientProfile,
    private readonly checkId: CheckId,
  ) {
    this.endpointFetch = target.fetch ?? ((request) => globalThis.fetch(request))
    this.originFetcher = target.originFetch ?? this.endpointFetch
  }

  evidence(): Exchange[] {
    return this.exchanges
  }

  async send(init: ProbeInit): Promise<ProbeResult> {
    return this.dispatch(this.endpointFetch, this.resolve(init.path), init)
  }

  async sendOrigin(path: string, init: ProbeInit = {}): Promise<ProbeResult> {
    return this.dispatch(this.originFetcher, this.resolve(path), { method: 'GET', ...init })
  }

  /**
   * A stateful Streamable HTTP server requires `initialize` before anything
   * else, and requires the `Mcp-Session-Id` it minted on every later request -
   * answering a cold `tools/list` with a missing-session error. Without this,
   * every catalog check would report such a server as broken across every
   * profile, which is a false negative on a perfectly conformant surface.
   *
   * So a legacy RPC other than `initialize` performs the handshake once per
   * probe and reuses the session id. Deliberately narrow:
   *
   * - Modern-era requests are skipped. The modern revision removes sessions;
   *   prefixing a modern request with a legacy `initialize` would be wrong.
   * - Anonymous requests are skipped. `unauthenticated-401-challenge` exists to
   *   observe the 401, and a handshake would only produce a second one.
   * - A failed handshake is swallowed. The check that follows reports the real
   *   failure with its own evidence; a handshake error here would mask it.
   */
  private async ensureLegacySession(init: Partial<ProbeInit>): Promise<void> {
    if (this.handshaking || this.legacySessionId !== undefined) return
    if (init.anonymous) return
    const marker = init.headers?.['mcp-protocol-version'] ?? init.headers?.['MCP-Protocol-Version']
    if (typeof marker === 'string' && marker.trim() >= MODERN_FLOOR) return

    this.handshaking = true
    try {
      const res = await this.rpc('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mcp-conformance', version: '0.1.0' },
      })
      this.legacySessionId = res.headers.get('mcp-session-id')
    } catch {
      this.legacySessionId = null
    } finally {
      this.handshaking = false
    }
  }

  async rpc(method: string, params?: unknown, init: Partial<ProbeInit> = {}): Promise<ProbeResult> {
    if (method !== 'initialize') await this.ensureLegacySession(init)
    const body: Record<string, unknown> = { jsonrpc: '2.0', id: 1, method }
    if (params !== undefined) body.params = params
    // `init` is spread FIRST so the merged headers below win. Spreading it last
    // silently replaced the whole header object with the caller's, dropping
    // `accept` - and a transport that requires both media types then answers
    // 406 to every parameterised check, which reads as a server failure.
    return this.send({
      ...init,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Both media types, as the Streamable HTTP transport requires of a
        // client that will accept either a JSON body or an SSE stream.
        accept: 'application/json, text/event-stream',
        ...init.headers,
      },
      body: JSON.stringify(body),
    })
  }

  /** A JSON-RPC notification: no `id`, so the transport must answer 202 with no body. */
  async notify(method: string, params?: unknown, init: Partial<ProbeInit> = {}): Promise<ProbeResult> {
    const body: Record<string, unknown> = { jsonrpc: '2.0', method }
    if (params !== undefined) body.params = params
    return this.send({
      ...init,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...init.headers,
      },
      body: JSON.stringify(body),
    })
  }

  private resolve(path: string | undefined): string {
    if (!path) return this.target.url
    if (/^https?:\/\//i.test(path)) return path
    return new URL(path, this.target.url).toString()
  }

  private async dispatch(fetcher: FetchLike, url: string, init: ProbeInit): Promise<ProbeResult> {
    const headers = new Headers(init.headers ?? {})
    if (!init.anonymous && this.target.credential) {
      headers.set('authorization', `Bearer ${this.target.credential}`)
    }
    // Echo the session the handshake established, unless the check set its own
    // (session-header-absent-or-echoed drives that header deliberately).
    if (this.legacySessionId && !headers.has('mcp-session-id')) {
      headers.set('mcp-session-id', this.legacySessionId)
    }
    const request = new Request(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
      redirect: init.manualRedirect === false ? 'follow' : DEFAULT_REDIRECT,
    })
    const recorded: Exchange['request'] = {
      method: request.method,
      url,
      headers: snapshotHeaders(headers),
      ...(init.body ? { body: truncate(init.body) } : {}),
    }

    let response: Response
    try {
      response = await fetcher(request)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'request failed'
      this.exchanges.push({ request: recorded, response: { error: message } })
      return { ok: false, status: 0, headers: new Headers(), text: '', error: message }
    }

    const text = await readBody(response)
    this.exchanges.push({
      request: recorded,
      response: {
        status: response.status,
        headers: snapshotHeaders(response.headers),
        ...(text ? { body: truncate(text) } : {}),
      },
    })

    let json: unknown
    if (text && text !== UNCONSUMED_SSE) {
      try {
        json = JSON.parse(text)
      } catch {
        /* not JSON; checks that need JSON will say so */
      }
    }
    return { ok: response.ok, status: response.status, headers: response.headers, text, json }
  }

  pass(detail: string): CheckResult {
    return { check: this.checkId, status: 'pass', detail, evidence: this.exchanges }
  }

  fail(detail: string, remediation: string): CheckResult {
    return { check: this.checkId, status: 'fail', detail, evidence: this.exchanges, remediation }
  }

  skip(detail: string): CheckResult {
    return { check: this.checkId, status: 'skip', detail, evidence: this.exchanges }
  }
}

/** Read a JSON-RPC `result` from a probe response, or explain why there is none. */
export function jsonRpcResult(res: ProbeResult): { result?: Record<string, unknown>; problem?: string } {
  if (res.error) return { problem: `request failed: ${res.error}` }
  if (res.json === undefined) return { problem: `HTTP ${res.status} with a non-JSON body` }
  const body = res.json as { result?: unknown; error?: { code?: number; message?: string } }
  if (body.error) {
    return { problem: `JSON-RPC error ${body.error.code ?? '?'}: ${body.error.message ?? 'no message'}` }
  }
  if (typeof body.result !== 'object' || body.result === null) {
    return { problem: `HTTP ${res.status} with no JSON-RPC \`result\` object` }
  }
  return { result: body.result as Record<string, unknown> }
}

/** Read a JSON-RPC error code, or `undefined` when the response is not an error. */
export function jsonRpcErrorCode(res: ProbeResult): number | undefined {
  const body = res.json as { error?: { code?: unknown } } | undefined
  const code = body?.error?.code
  return typeof code === 'number' ? code : undefined
}

/** Split a comma-separated header into lowercase tokens. */
export function headerList(value: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}
