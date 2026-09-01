/**
 * Authorization-discovery checks: the 401 challenge and the two `.well-known`
 * document families a client walks to find an authorization server.
 *
 * This is the part of the surface that cost the most to learn. Grok's first
 * real connect failed because `/.well-known/oauth-authorization-server` was a
 * 308 to a different-origin authorization server (which it would not follow)
 * and the path-suffixed
 * form on the resource origin did not exist, so discovery dead-ended
 * (docs/evidence/grok-connector.md section 5). Claude walks the same documents in a
 * different order. Both orders are covered here, per profile.
 */

import type { Check, CheckContext, CheckResult, ProbeResult } from '../types.ts'

/** The path component of the MCP endpoint, e.g. `/mcp` -> `mcp`. */
function endpointPathSegment(url: string): string {
  return new URL(url).pathname.replace(/^\/+/, '').replace(/\/+$/, '')
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b, a).origin
  } catch {
    return false
  }
}

function resourceMetadataFromChallenge(value: string | null): string | undefined {
  const match = /resource_metadata\s*=\s*"([^"]+)"/i.exec(value ?? '')
  return match?.[1]
}

export const unauthenticated401Challenge: Check = {
  id: 'unauthenticated-401-challenge',
  title: 'an unauthenticated request answers 401 with a PRM challenge',
  requirement:
    'An anonymous POST returns HTTP 401 carrying WWW-Authenticate: Bearer with a resource_metadata parameter pointing at the protected resource metadata document (RFC 9728).',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'mcp-conformance', version: '0.1.0' },
    }, { anonymous: true })

    if (res.status !== 401) {
      return ctx.fail(
        `anonymous initialize returned HTTP ${res.status}, expected 401`,
        'Answer an unauthenticated request with 401. Clients do not honor a WWW-Authenticate header on a 200, and a 403 without an error="insufficient_scope" parameter does not re-trigger the auth flow either - so anything but a 401 means the connector never starts OAuth discovery.',
      )
    }
    const challenge = res.headers.get('www-authenticate')
    if (!challenge) {
      return ctx.fail(
        '401 carried no WWW-Authenticate header',
        'Add WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/<path>" to the 401. Without the pointer a client must guess the metadata location, and at least one real client concludes no authentication is required at all.',
      )
    }
    if (!/bearer/i.test(challenge)) {
      return ctx.fail(
        `WWW-Authenticate does not name the Bearer scheme: ${challenge}`,
        'Use the Bearer scheme in the challenge.',
      )
    }
    const resourceMetadata = resourceMetadataFromChallenge(challenge)
    if (!resourceMetadata) {
      return ctx.fail(
        `WWW-Authenticate has no resource_metadata parameter: ${challenge}`,
        'Include resource_metadata="<url>" in the challenge (RFC 9728). It is the pointer every OAuth-capable MCP client follows first.',
      )
    }
    return ctx.pass(`401 with resource_metadata=${resourceMetadata}`)
  },
}

/** Read one `.well-known` path and describe what came back. */
async function probeWellKnown(
  ctx: CheckContext,
  path: string,
): Promise<{ path: string; res: ProbeResult }> {
  const res = await ctx.sendOrigin(path, { anonymous: true })
  return { path, res }
}

/** RFC 8414 and OpenID Connect discovery locations for one HTTPS issuer. */
function authorizationServerMetadataUrls(issuer: string): string[] {
  try {
    const parsed = new URL(issuer)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return []
    }
    const issuerPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')
    return [
      `${parsed.origin}/.well-known/oauth-authorization-server${issuerPath}`,
      `${parsed.origin}${issuerPath}/.well-known/openid-configuration`,
    ]
  } catch {
    return []
  }
}

/** Follow the RFC 9728 document instead of assuming resource server == AS. */
async function advertisedAuthorizationServers(ctx: CheckContext): Promise<string[]> {
  const segment = endpointPathSegment(ctx.target.url)
  const metadataUrls = new Set<string>()

  // ChatGPT follows the exact pointer in the 401 challenge when present. This
  // also keeps the check useful against older runtimes that advertised a
  // noncanonical but reachable metadata path.
  const challenge = await ctx.rpc(
    'initialize',
    {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'mcp-conformance', version: '0.1.0' },
    },
    { anonymous: true },
  )
  const advertised = resourceMetadataFromChallenge(challenge.headers.get('www-authenticate'))
  if (advertised) metadataUrls.add(advertised)

  if (segment) metadataUrls.add(`/.well-known/oauth-protected-resource/${segment}`)
  metadataUrls.add('/.well-known/oauth-protected-resource')

  const issuers = new Set<string>()
  for (const url of metadataUrls) {
    const res = await ctx.sendOrigin(url, { anonymous: true })
    if (res.status !== 200) continue
    const doc = res.json as { authorization_servers?: unknown } | undefined
    if (!Array.isArray(doc?.authorization_servers)) continue
    for (const value of doc.authorization_servers) {
      if (typeof value === 'string' && value.length > 0) issuers.add(value)
    }
  }
  return [...issuers]
}

export const prmDocumentServed: Check = {
  id: 'prm-document-served',
  title: 'protected resource metadata is served at both RFC 9728 paths',
  requirement:
    'Both /.well-known/oauth-protected-resource/<mcp-path> and /.well-known/oauth-protected-resource return 200 with a resource field and a non-empty authorization_servers array.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const segment = endpointPathSegment(ctx.target.url)
    const paths = ['/.well-known/oauth-protected-resource']
    // Claude fetches the path-suffixed form FIRST and the root form second;
    // serving only one of the two makes the surface work in one client and not
    // another, which is the failure mode this whole package exists to end.
    if (segment) paths.unshift(`/.well-known/oauth-protected-resource/${segment}`)

    const problems: string[] = []
    let servedResource: string | undefined
    for (const path of paths) {
      const { res } = await probeWellKnown(ctx, path)
      if (res.status !== 200) {
        problems.push(`${path}: HTTP ${res.status}`)
        continue
      }
      const doc = res.json as { resource?: unknown; authorization_servers?: unknown } | undefined
      if (typeof doc?.resource !== 'string') {
        problems.push(`${path}: no string resource field`)
        continue
      }
      servedResource = doc.resource
      if (!Array.isArray(doc.authorization_servers) || doc.authorization_servers.length === 0) {
        problems.push(`${path}: authorization_servers is empty`)
      }
    }
    if (problems.length > 0) {
      return ctx.fail(
        `protected resource metadata incomplete: ${problems.join('; ')}`,
        `Serve the RFC 9728 document at both ${paths.join(' and ')} with a 200. The path-suffixed form is what a client derives from the MCP URL; the root form is what a client that ignores the path falls back to. Serving only one strands whichever client uses the other.`,
      )
    }
    return ctx.pass(`served at ${paths.join(' and ')}; resource=${servedResource}`)
  },
}

export const asMetadataBothPaths: Check = {
  id: 'as-metadata-both-paths',
  title: 'authorization-server metadata is served 200 at both paths',
  requirement:
    'Both /.well-known/oauth-authorization-server and /.well-known/oauth-authorization-server/<mcp-path> return 200 on the resource origin, with authorization_endpoint and token_endpoint.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const segment = endpointPathSegment(ctx.target.url)
    const paths = ['/.well-known/oauth-authorization-server']
    if (segment) paths.push(`/.well-known/oauth-authorization-server/${segment}`)

    const problems: string[] = []
    for (const path of paths) {
      const { res } = await probeWellKnown(ctx, path)
      if (res.status !== 200) {
        problems.push(
          `${path}: HTTP ${res.status}${isRedirect(res.status) ? ` -> ${res.headers.get('location') ?? 'unknown'}` : ''}`,
        )
        continue
      }
      const doc = res.json as { authorization_endpoint?: unknown; token_endpoint?: unknown } | undefined
      if (typeof doc?.authorization_endpoint !== 'string' || typeof doc.token_endpoint !== 'string') {
        problems.push(`${path}: missing authorization_endpoint or token_endpoint`)
      }
    }
    if (problems.length > 0) {
      return ctx.fail(
        `authorization-server metadata not served on the resource origin: ${problems.join('; ')}`,
        'Mirror the authorization server document with a 200 at both paths on the resource origin. This is exactly the gap that dead-ended Grok discovery: the root path was a 308 to another origin, and the path-suffixed fallback did not exist.',
      )
    }
    return ctx.pass(`200 at ${paths.join(' and ')}`)
  },
}

export const asMetadataOriginConsistent: Check = {
  id: 'as-metadata-origin-consistent',
  title: 'the virtual authorization server is self-consistent',
  requirement:
    'Protected-resource metadata names the MCP resource origin as its authorization server, whose issuer and OAuth endpoints all remain on that same origin.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const origin = new URL(ctx.target.url).origin
    const segment = endpointPathSegment(ctx.target.url)
    const prmPaths = [
      '/.well-known/oauth-protected-resource',
      ...(segment ? [`/.well-known/oauth-protected-resource/${segment}`] : []),
    ]
    const asPaths = [
      '/.well-known/oauth-authorization-server',
      ...(segment ? [`/.well-known/oauth-authorization-server/${segment}`] : []),
    ]
    const problems: string[] = []

    for (const path of prmPaths) {
      const res = await ctx.sendOrigin(path, { anonymous: true })
      if (res.status !== 200) {
        problems.push(`${path}: HTTP ${res.status}`)
        continue
      }
      const doc = res.json as { authorization_servers?: unknown } | undefined
      const issuers = Array.isArray(doc?.authorization_servers)
        ? doc.authorization_servers.filter((value): value is string => typeof value === 'string')
        : []
      if (!issuers.includes(origin)) {
        problems.push(
          `${path}: authorization_servers=${JSON.stringify(issuers)}, expected ${origin}`,
        )
      }
    }

    for (const path of asPaths) {
      const res = await ctx.sendOrigin(path, { anonymous: true })
      if (res.status !== 200) {
        problems.push(`${path}: HTTP ${res.status}`)
        continue
      }
      const doc = res.json as Record<string, unknown> | undefined
      if (doc?.issuer !== origin) {
        problems.push(`${path}: issuer=${JSON.stringify(doc?.issuer)}, expected ${origin}`)
      }
      for (const field of [
        'authorization_endpoint',
        'token_endpoint',
        'registration_endpoint',
      ] as const) {
        const endpoint = doc?.[field]
        if (typeof endpoint !== 'string' || !sameOrigin(origin, endpoint)) {
          problems.push(`${path}: ${field}=${JSON.stringify(endpoint)} is not on ${origin}`)
        }
      }
    }

    if (problems.length > 0) {
      return ctx.fail(
        `virtual authorization server is inconsistent: ${problems.join('; ')}`,
        'Advertise the MCP resource origin in authorization_servers and serve metadata whose issuer, authorization_endpoint, token_endpoint, and registration_endpoint use that exact origin. Reverse-proxy /oauth/* to the backing authorization service instead of exposing its origin to the client.',
      )
    }
    return ctx.pass(`PRM, issuer, and OAuth endpoints consistently use ${origin}`)
  },
}

export const authorizationEndpointSameOrigin: Check = {
  id: 'authorization-endpoint-same-origin',
  title: 'the authorization endpoint stays on the resource origin',
  requirement:
    'The authorization endpoint advertised by the resource-origin metadata is reachable there and does not redirect a probe to another origin.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const origin = new URL(ctx.target.url).origin
    const metadata = await ctx.sendOrigin('/.well-known/oauth-authorization-server', {
      anonymous: true,
    })
    if (metadata.status !== 200) {
      return ctx.fail(
        `resource-origin authorization-server metadata returned HTTP ${metadata.status}`,
        'Serve authorization-server metadata with HTTP 200 on the MCP resource origin before advertising a same-origin authorization endpoint.',
      )
    }
    const doc = metadata.json as { authorization_endpoint?: unknown } | undefined
    const endpoint = doc?.authorization_endpoint
    if (typeof endpoint !== 'string' || !sameOrigin(origin, endpoint)) {
      return ctx.fail(
        `authorization_endpoint=${JSON.stringify(endpoint)} is not on ${origin}`,
        'Advertise a same-origin /oauth/authorize endpoint and reverse-proxy it to the backing authorization service.',
      )
    }

    const res = await ctx.sendOrigin(endpoint, { method: 'HEAD', anonymous: true })
    if (
      res.error ||
      res.status === 0 ||
      res.status === 404 ||
      res.status === 405 ||
      res.status >= 500
    ) {
      return ctx.fail(
        `HEAD ${endpoint} returned ${res.error ? `an error: ${res.error}` : `HTTP ${res.status}`}`,
        'Serve HEAD and GET on the advertised authorization endpoint from the resource origin. A missing route or upstream failure makes clients reject the virtual authorization server before showing login.',
      )
    }
    if (isRedirect(res.status)) {
      const location = res.headers.get('location')
      if (!location || !sameOrigin(origin, location)) {
        return ctx.fail(
          `HEAD ${endpoint} redirected cross-origin with HTTP ${res.status} to ${location ?? '(no Location)'}`,
          'Reverse-proxy the authorization endpoint instead of redirecting it to the backing authorization-server origin.',
        )
      }
    }
    return ctx.pass(`HEAD ${endpoint} stayed on ${origin} with HTTP ${res.status}`)
  },
}

export const asMetadataNoCrossOriginRedirect: Check = {
  id: 'as-metadata-no-cross-origin-redirect',
  title: 'metadata discovery never redirects cross-origin',
  requirement:
    'None of the .well-known discovery documents answer with a 3xx to a different origin. A client that will not follow one dead-ends there.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const segment = endpointPathSegment(ctx.target.url)
    const paths = [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-authorization-server',
      '/.well-known/openid-configuration',
      ...(segment
        ? [
            `/.well-known/oauth-protected-resource/${segment}`,
            `/.well-known/oauth-authorization-server/${segment}`,
          ]
        : []),
    ]
    const offenders: string[] = []
    for (const path of paths) {
      const { res } = await probeWellKnown(ctx, path)
      if (!isRedirect(res.status)) continue
      const location = res.headers.get('location')
      if (!location) {
        offenders.push(`${path}: ${res.status} with no Location`)
        continue
      }
      if (!sameOrigin(ctx.target.url, location)) {
        offenders.push(`${path}: ${res.status} -> ${location}`)
      }
    }
    if (offenders.length > 0) {
      return ctx.fail(
        `cross-origin redirects in discovery: ${offenders.join('; ')}`,
        'Serve the document body on the resource origin instead of redirecting. Grok was observed refusing to follow a cross-origin 308 for authorization-server metadata and falling back to the path-suffixed form on the resource origin (docs/evidence/grok-connector.md section 5). Mirroring the JSON rather than redirecting keeps the upstream issuer authoritative while giving such a client a same-origin 200.',
      )
    }
    return ctx.pass(`no cross-origin redirect across ${paths.length} discovery paths`)
  },
}

export const asMetadataPkceS256: Check = {
  id: 'as-metadata-pkce-s256',
  title: 'authorization-server metadata advertises PKCE S256',
  requirement:
    'The authorization server metadata lists S256 in code_challenge_methods_supported.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const issuers = await advertisedAuthorizationServers(ctx)
    const candidates = new Set<string>()
    for (const issuer of issuers) {
      for (const url of authorizationServerMetadataUrls(issuer)) candidates.add(url)
    }

    if (issuers.length > 0 && candidates.size === 0) {
      return ctx.fail(
        `protected-resource metadata advertises no valid HTTPS authorization-server issuer: ${issuers.join(', ')}`,
        'Publish an HTTPS issuer URL without credentials, query, or fragment in authorization_servers.',
      )
    }

    // Compatibility fallback for a legacy surface with no usable PRM. When an
    // issuer is advertised, only its documents are authoritative.
    if (issuers.length === 0) {
      const segment = endpointPathSegment(ctx.target.url)
      candidates.add('/.well-known/oauth-authorization-server')
      if (segment) candidates.add(`/.well-known/oauth-authorization-server/${segment}`)
      candidates.add('/.well-known/openid-configuration')
    }

    const seen: string[] = []
    for (const url of candidates) {
      const res = await ctx.sendOrigin(url, { anonymous: true })
      if (res.status !== 200) {
        seen.push(`${url}: HTTP ${res.status}`)
        continue
      }
      const doc = res.json as { code_challenge_methods_supported?: unknown } | undefined
      const methods = doc?.code_challenge_methods_supported
      if (!Array.isArray(methods)) {
        seen.push(`${url}: no code_challenge_methods_supported`)
        continue
      }
      if (!methods.map(String).includes('S256')) {
        seen.push(`${url}: advertises ${methods.map(String).join(', ')}`)
        continue
      }
      return ctx.pass(`${url} advertises S256`)
    }
    return ctx.fail(
      seen.length > 0
        ? `S256 not advertised: ${seen.join('; ')}`
        : 'no authorization-server metadata document was reachable to check',
      'Add "S256" to code_challenge_methods_supported on the authorization server named by protected-resource metadata. Do not diagnose the MCP resource origin unless it is also the advertised issuer.',
    )
  },
}

export const asMetadataRfc9207Cimd: Check = {
  id: 'as-metadata-rfc9207-cimd',
  title: 'authorization metadata advertises RFC 9207 and CIMD',
  requirement:
    'The advertised authorization-server metadata sets authorization_response_iss_parameter_supported and client_id_metadata_document_supported to true.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const issuers = await advertisedAuthorizationServers(ctx)
    const candidates = new Set<string>()
    for (const issuer of issuers) {
      for (const url of authorizationServerMetadataUrls(issuer)) candidates.add(url)
    }
    if (issuers.length === 0) {
      const segment = endpointPathSegment(ctx.target.url)
      candidates.add('/.well-known/oauth-authorization-server')
      if (segment) candidates.add(`/.well-known/oauth-authorization-server/${segment}`)
      candidates.add('/.well-known/openid-configuration')
    }

    const seen: string[] = []
    for (const url of candidates) {
      const res = await ctx.sendOrigin(url, { anonymous: true })
      if (res.status !== 200) {
        seen.push(`${url}: HTTP ${res.status}`)
        continue
      }
      const doc = res.json as
        | {
            authorization_response_iss_parameter_supported?: unknown
            client_id_metadata_document_supported?: unknown
          }
        | undefined
      const missing = [
        ...(doc?.authorization_response_iss_parameter_supported === true
          ? []
          : ['authorization_response_iss_parameter_supported']),
        ...(doc?.client_id_metadata_document_supported === true
          ? []
          : ['client_id_metadata_document_supported']),
      ]
      if (missing.length === 0) return ctx.pass(`${url} advertises RFC 9207 and CIMD`)
      seen.push(`${url}: missing true ${missing.join(', ')}`)
    }

    return ctx.fail(
      seen.length > 0
        ? `RFC 9207/CIMD compatibility flags absent: ${seen.join('; ')}`
        : 'no authorization-server metadata document was reachable to check',
      'Set authorization_response_iss_parameter_supported and client_id_metadata_document_supported to true in the authorization-server metadata, then ensure the real authorize flow honors both claims.',
    )
  },
}

export const oauthAuthorizationCodeFlow: Check = {
  id: 'oauth-authorization-code-flow',
  title: 'a real client completes the OAuth authorization-code flow',
  requirement:
    'A real connector completes authorization with an exact RFC 9207 iss value, CIMD-derived redirect registration, and an access-token response whose aud equals the requested MCP resource.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    return ctx.skip(
      'manual-only: completing this flow requires a real third-party connector, browser consent, and a minted access token',
    )
  },
}
