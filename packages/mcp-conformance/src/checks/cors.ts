/**
 * CORS checks.
 *
 * Read the confidence markers on these carefully. No first-party documentation
 * from Anthropic, OpenAI, or xAI requires CORS on the MCP endpoint itself -
 * every one of those clients reaches the server from the vendor's own backend,
 * where CORS does not apply. The requirement is real for browser-resident
 * clients and for the assets an MCP App fetches from the user's device, and it
 * is normative policy for every surface in this template
 * (docs/dual-era-policy.md, server checklist item 1).
 *
 * So these checks are carried by the platform-policy profile and by profiles for
 * clients that genuinely run in a page - never asserted as an Anthropic or
 * OpenAI client requirement, which would be inventing a vendor requirement to
 * gate CI on.
 */

import { headerList } from '../probe.ts'
import type { Check, CheckContext, CheckResult } from '../types.ts'

/** Headers a dual-era client sends and so must be allowed through a preflight. */
const DEFAULT_REQUIRED_ALLOWED = [
  'authorization',
  'content-type',
  'mcp-session-id',
  'mcp-protocol-version',
  'mcp-method',
  'mcp-name',
] as const

/** Headers a browser client must be able to read off the response. */
const DEFAULT_REQUIRED_EXPOSED = ['mcp-session-id', 'www-authenticate'] as const

export const corsPreflight: Check = {
  id: 'cors-preflight',
  title: 'OPTIONS preflight succeeds',
  requirement:
    'An OPTIONS preflight returns a 2xx with Access-Control-Allow-Origin and an Access-Control-Allow-Methods list that includes POST.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.send({
      method: 'OPTIONS',
      anonymous: true,
      headers: {
        origin: 'https://example.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type, mcp-protocol-version',
      },
    })
    if (res.status >= 300) {
      return ctx.fail(
        `preflight returned HTTP ${res.status}`,
        'Answer OPTIONS with a 200 or 204 carrying the CORS headers. A browser treats any other status as a failed preflight and never sends the real request.',
      )
    }
    const allowOrigin = res.headers.get('access-control-allow-origin')
    if (!allowOrigin) {
      return ctx.fail(
        'preflight carried no Access-Control-Allow-Origin',
        'Return Access-Control-Allow-Origin on the preflight response.',
      )
    }
    const methods = headerList(res.headers.get('access-control-allow-methods'))
    if (methods.length > 0 && !methods.includes('post')) {
      return ctx.fail(
        `Access-Control-Allow-Methods does not include POST: ${methods.join(', ')}`,
        'Include POST in Access-Control-Allow-Methods. Every MCP message is a POST.',
      )
    }
    return ctx.pass(`preflight ${res.status}, allow-origin ${allowOrigin}`)
  },
}

export const corsAllowedHeaders: Check = {
  id: 'cors-allowed-headers',
  title: 'the preflight allows every header a dual-era client sends',
  requirement:
    'Access-Control-Allow-Headers names authorization, content-type, mcp-session-id, mcp-protocol-version, mcp-method, and mcp-name - or the surface reflects Access-Control-Request-Headers.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const required = ctx.requirement.params?.requiredAllowedHeaders ?? DEFAULT_REQUIRED_ALLOWED
    const res = await ctx.send({
      method: 'OPTIONS',
      anonymous: true,
      headers: {
        origin: 'https://example.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': required.join(', '),
      },
    })
    const raw = res.headers.get('access-control-allow-headers')
    const allowed = headerList(raw)
    // A surface may reflect the requested list, or answer `*`. Both satisfy the
    // requirement; `*` does not cover `Authorization` in the CORS spec, so it is
    // only sufficient when Authorization is also named explicitly.
    if (allowed.includes('*') && allowed.includes('authorization')) {
      return ctx.pass('allows * plus an explicit authorization')
    }
    const missing = required.map((h) => h.toLowerCase()).filter((h) => !allowed.includes(h))
    if (missing.length > 0) {
      return ctx.fail(
        `Access-Control-Allow-Headers is missing ${missing.join(', ')} (got: ${raw ?? '(none)'})`,
        'Add the missing header names to the allow-list. Access-Control-Allow-Headers matches literal names, so a wildcard does not cover Authorization and a prefix like Mcp-Param-* is not expanded - enumerate the concrete names, or reflect Access-Control-Request-Headers.',
      )
    }
    return ctx.pass(`allows ${required.join(', ')}`)
  },
}

export const corsExposedHeaders: Check = {
  id: 'cors-exposed-headers',
  title: 'response headers a browser client needs are exposed',
  requirement:
    'Access-Control-Expose-Headers names mcp-session-id and www-authenticate, so a browser client can read the session id and the auth challenge.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const required = ctx.requirement.params?.requiredExposedHeaders ?? DEFAULT_REQUIRED_EXPOSED
    const res = await ctx.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'mcp-conformance', version: '0.1.0' },
    }, { headers: { origin: 'https://example.test' } })
    const raw = res.headers.get('access-control-expose-headers')
    const exposed = headerList(raw)
    if (exposed.includes('*')) return ctx.pass('exposes *')
    const missing = required.map((h) => h.toLowerCase()).filter((h) => !exposed.includes(h))
    if (missing.length > 0) {
      return ctx.fail(
        `Access-Control-Expose-Headers is missing ${missing.join(', ')} (got: ${raw ?? '(none)'})`,
        'Add the missing names to Access-Control-Expose-Headers. Without mcp-session-id a browser client cannot resume a session; without www-authenticate it cannot read the auth challenge off a 401 and never starts OAuth discovery.',
      )
    }
    return ctx.pass(`exposes ${required.join(', ')}`)
  },
}
