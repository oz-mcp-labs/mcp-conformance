/**
 * Transport-level checks that are not about a single JSON-RPC method: what the
 * response media type is, what GET and DELETE do, and whether the surface
 * mints a session id.
 *
 * The media-type check earns its place: both official SDKs throw a transport
 * error on any response media type other than `application/json` or
 * `text/event-stream`, so an HTML error page from a CDN or a framework's
 * default 500 page terminates the connection rather than surfacing as a
 * JSON-RPC error the client can report.
 */

import { jsonRpcResult } from '../probe.ts'
import type { Check, CheckContext, CheckResult } from '../types.ts'

/** Media-type essence, without parameters: `application/json; charset=utf-8` -> `application/json`. */
function essence(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

export const responseContentType: Check = {
  id: 'response-content-type',
  title: 'POST responses use application/json or text/event-stream',
  requirement:
    'A POST carrying a JSON-RPC request answers with exactly one of application/json or text/event-stream. Any other media type is a transport error in both official SDKs, not a readable failure.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'mcp-conformance', version: '0.1.0' },
    })
    const media = essence(res.headers.get('content-type'))
    if (media === 'application/json' || media === 'text/event-stream') {
      return ctx.pass(`answered ${media}`)
    }
    return ctx.fail(
      `initialize answered content-type ${media || '(none)'} with HTTP ${res.status}`,
      'Answer a JSON-RPC POST with application/json or text/event-stream. An HTML error page or a bare 500 from an edge proxy is thrown as an unrecoverable transport error rather than reported to the user as a server error.',
    )
  },
}

export const sseGetStream: Check = {
  id: 'sse-get-stream',
  title: 'GET answers 405 or an SSE stream',
  requirement:
    'GET on the MCP endpoint returns 405 when no standalone stream is offered, or text/event-stream when one is. It never returns a 200 HTML page or a 5xx.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.send({ method: 'GET', headers: { accept: 'text/event-stream' } })
    if (res.status === 405) return ctx.pass('405 Method Not Allowed - no standalone stream, which clients treat as fine')
    const media = essence(res.headers.get('content-type'))
    if (res.status === 200 && media === 'text/event-stream') return ctx.pass('200 text/event-stream')
    if (res.status === 401 || res.status === 403) {
      return ctx.pass(`${res.status} - the endpoint is auth-gated, which is a valid answer to an anonymous GET`)
    }
    return ctx.fail(
      `GET returned HTTP ${res.status} ${media || '(no content-type)'}`,
      'Answer GET with 405 when the surface serves no standalone SSE stream, or with text/event-stream when it does. A 200 HTML page makes a client that probes for the legacy HTTP+SSE pair transport misidentify the surface, and a 5xx makes it mark the server unhealthy.',
    )
  },
}

export const deleteMethodHandled: Check = {
  id: 'delete-method-handled',
  title: 'DELETE does not 5xx',
  requirement:
    'DELETE on the MCP endpoint answers 200, 204, 404, or 405. A server that does not permit client session termination answers 405, which clients treat as success.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.send({ method: 'DELETE' })
    if ([200, 202, 204, 400, 401, 403, 404, 405].includes(res.status)) {
      return ctx.pass(`DELETE answered ${res.status}`)
    }
    return ctx.fail(
      `DELETE returned HTTP ${res.status}`,
      'Answer DELETE with 405 when sessions cannot be terminated by the client. Clients call it on shutdown and treat a 405 as success; a 5xx surfaces as a disconnect error on every close.',
    )
  },
}

export const sessionHeaderAbsentOrEchoed: Check = {
  id: 'session-header-absent-or-echoed',
  title: 'session handling is coherent',
  requirement:
    'Either the surface mints no Mcp-Session-Id at all (stateless), or it mints one on the initialize response and then serves requests that carry it.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const init = await ctx.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'mcp-conformance', version: '0.1.0' },
    })
    const sessionId = init.headers.get('mcp-session-id')
    if (!sessionId) {
      // Stateless is the modern era's default and is explicitly fine: the
      // client simply never sends the header back.
      const follow = await ctx.rpc('tools/list')
      const { result, problem } = jsonRpcResult(follow)
      if (!result) {
        return ctx.fail(
          `no Mcp-Session-Id was minted, but a follow-up tools/list still failed: ${problem}`,
          'A stateless surface must serve every request without session state. If the surface does need a session, mint an Mcp-Session-Id on the initialize response so clients know to echo one.',
        )
      }
      return ctx.pass('stateless: no Mcp-Session-Id minted, follow-up requests served')
    }
    if (!/^[\x21-\x7e]+$/.test(sessionId)) {
      return ctx.fail(
        `Mcp-Session-Id contains characters outside visible ASCII: ${JSON.stringify(sessionId)}`,
        'Restrict the session id to visible ASCII (0x21-0x7E), as the transport requires.',
      )
    }
    const follow = await ctx.rpc('tools/list', undefined, { headers: { 'mcp-session-id': sessionId } })
    const { result, problem } = jsonRpcResult(follow)
    if (!result) {
      return ctx.fail(
        `the minted session id was rejected on the next request: ${problem}`,
        'Serve requests that echo the session id the initialize response minted. Minting an id and then rejecting it is worse than being stateless, because the client has no way back.',
      )
    }
    return ctx.pass(`minted and honored Mcp-Session-Id (${sessionId.length} chars)`)
  },
}

export const initializeSessionIdIssued: Check = {
  id: 'initialize-session-id-issued',
  title: 'initialize issues an MCP session id',
  requirement:
    'The legacy initialize response carries a non-empty visible-ASCII Mcp-Session-Id header for clients that require one to continue bootstrap.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const init = await ctx.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'mcp-conformance', version: '0.1.0' },
    })
    const { result, problem } = jsonRpcResult(init)
    if (!result) {
      return ctx.fail(
        `initialize failed before a session id could be checked: ${problem}`,
        'Return a successful legacy initialize response before assigning the Mcp-Session-Id header.',
      )
    }

    const sessionId = init.headers.get('mcp-session-id')
    if (!sessionId) {
      return ctx.fail(
        'initialize returned no Mcp-Session-Id header',
        'Assign an opaque Mcp-Session-Id on every legacy initialize response. The transport makes this optional, but ChatGPT was observed aborting immediately after a successful initialize when it was absent and continuing when it was present.',
      )
    }
    if (!/^[\x21-\x7e]+$/.test(sessionId)) {
      return ctx.fail(
        `Mcp-Session-Id contains characters outside visible ASCII: ${JSON.stringify(sessionId)}`,
        'Use an opaque visible-ASCII session identifier such as a UUID.',
      )
    }
    return ctx.pass(`initialize issued Mcp-Session-Id (${sessionId.length} chars)`)
  },
}
