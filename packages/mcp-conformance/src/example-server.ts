/**
 * A minimal dual-era MCP server, written to satisfy every check in the
 * registry.
 *
 * It exists for two reasons. First, a check suite that has never been run
 * against a known-good server cannot distinguish "the surface is broken" from
 * "the check is broken"; the mutation tests next to it flip one behavior at a
 * time and assert that exactly the corresponding check goes red. Second, it is
 * the shortest readable statement of what the registry actually demands - about
 * 250 lines, which is a useful thing to be able to point at.
 *
 * It is deliberately NOT shared with the hosted runtime. The runtime is the
 * thing under test; a reference implementation that imported it would prove
 * nothing.
 */

const LEGACY_VERSIONS = ['2025-03-26', '2025-06-18', '2025-11-25'] as const
const LEGACY_LATEST = '2025-11-25'
const MODERN_VERSION = '2026-07-28'
const MODERN_FLOOR = '2026-07-28'
const ADVERTISED = [MODERN_VERSION, '2025-11-25', '2025-06-18', '2025-03-26']

const UI_EXTENSION = 'io.modelcontextprotocol/ui'
const META_VERSION = 'io.modelcontextprotocol/protocolVersion'
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo'
const WIDGET_MIME = 'text/html;profile=mcp-app'
const WIDGET_URI = 'ui://example/panel'

/** Modern-only methods; their presence is an era signal on its own. */
const MODERN_ONLY_METHODS = new Set(['server/discover', 'subscriptions/listen'])

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers':
    'authorization, content-type, mcp-session-id, mcp-protocol-version, mcp-method, mcp-name',
  'access-control-expose-headers': 'mcp-session-id, www-authenticate',
}

const TOOLS = [
  {
    name: 'alpha',
    description: 'Return a greeting.',
    inputSchema: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] },
    annotations: { title: 'Greet', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'show_panel',
    description: 'Render the reference panel.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Show panel', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { [UI_EXTENSION]: { resourceUri: WIDGET_URI } },
  },
  {
    name: 'zeta',
    description: 'Do nothing, last in sort order.',
    inputSchema: { type: 'object', properties: {} },
    // Explicit false values are present and must not be mistaken for omissions.
    annotations: { title: 'Zeta', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
]

const RESOURCES = [
  { uri: WIDGET_URI, name: 'reference panel', mimeType: WIDGET_MIME },
  { uri: 'example://note', name: 'note', mimeType: 'text/plain' },
]

export interface ExampleServerOptions {
  /**
   * When set, an anonymous request is answered 401 with a PRM challenge.
   * Requests carrying this bearer token are served.
   */
  credential?: string
  /** Origin used to build the WWW-Authenticate pointer and the .well-known documents. */
  origin?: string
  /** Path the endpoint is mounted at, for the path-suffixed .well-known forms. */
  path?: string
  /** Authorization-server issuer. Defaults to the protected-resource origin. */
  authorizationServerOrigin?: string
  /** Behaviors to break, one at a time, so a mutation test can assert a check catches it. */
  break?: Partial<Record<Mutation, boolean>>
}

/** One deliberately broken behavior. Each maps to exactly one check. */
export type Mutation =
  | 'versionEcho'
  | 'echoModernFromInitialize'
  | 'notificationJsonRpcAnswer'
  | 'omitToolsCapability'
  | 'omitUiExtension'
  | 'unstableToolOrder'
  | 'unknownMethod500'
  | 'getReturnsHtml'
  | 'getReturnsOpenSseStream'
  | 'deleteReturns500'
  | 'noServerDiscover'
  | 'noResultType'
  | 'noCacheHints'
  | 'downgradeUnknownModernVersion'
  | 'headerMismatchOnLegacy'
  | 'danglingWidgetLink'
  | 'wrongWidgetMime'
  | 'omitAnnotations'
  | 'omitOpenWorldHint'
  | 'plainTextResponse'
  | 'noChallengeHeader'
  | 'corsMissingHeaders'
  | 'crossOriginAsRedirect'
  | 'noPathSuffixedPrm'
  | 'noPkceS256'
  | 'requireSession'
  | 'loggingSetLevelUnimplemented'

interface JsonRpcMessage {
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...extra },
  })
}

function rpcResult(id: unknown, result: unknown): Response {
  return json({ jsonrpc: '2.0', id: id ?? null, result })
}

function rpcError(id: unknown, code: number, message: string, status = 200, data?: unknown): Response {
  return json({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } }, status)
}

/** Era detection: the header/meta VALUE decides, compared lexicographically on the raw string. */
function detectModern(request: Request, message: JsonRpcMessage): { modern: boolean; marker: string | null } {
  if (message.method === 'initialize') return { modern: false, marker: null }
  if (message.method && MODERN_ONLY_METHODS.has(message.method)) return { modern: true, marker: MODERN_VERSION }
  const meta = message.params?._meta as Record<string, unknown> | undefined
  const fromMeta = typeof meta?.[META_VERSION] === 'string' ? (meta[META_VERSION] as string) : undefined
  const marker = fromMeta ?? request.headers.get('mcp-protocol-version')?.trim() ?? null
  if (!marker) return { modern: false, marker: null }
  return { modern: marker >= MODERN_FLOOR, marker }
}

export function createExampleServer(options: ExampleServerOptions = {}) {
  const broken = options.break ?? {}
  const origin = options.origin ?? 'https://reference.test'
  const path = options.path ?? '/mcp'
  const authorizationServerOrigin = options.authorizationServerOrigin ?? origin
  const segment = path.replace(/^\/+/, '').replace(/\/+$/, '')
  let listCalls = 0

  const capabilities = () => ({
    tools: broken.omitToolsCapability ? undefined : { listChanged: false },
    resources: { subscribe: false, listChanged: false },
    // Declared because it is implemented below. The reference client calls
    // logging/setLevel right after initialize when this is present, so a
    // surface that declares it and answers -32601 loses the session before its
    // first tools/list - which is the bug the Inspector suite exists to catch.
    logging: {},
    ...(broken.omitUiExtension
      ? {}
      : { extensions: { [UI_EXTENSION]: { mimeTypes: [WIDGET_MIME] } } }),
  })

  const tools = () => {
    const base = broken.danglingWidgetLink
      ? TOOLS.map((t) =>
          t.name === 'show_panel' ? { ...t, _meta: { [UI_EXTENSION]: { resourceUri: 'ui://example/missing' } } } : t,
        )
      : TOOLS
    const complete = broken.omitOpenWorldHint
      ? base.map((entry) => {
          const { openWorldHint: _openWorldHint, ...annotations } = entry.annotations
          return { ...entry, annotations }
        })
      : base
    const annotated = broken.omitAnnotations
      ? complete.map(({ annotations: _annotations, ...rest }) => rest)
      : complete
    if (!broken.unstableToolOrder) return [...annotated].sort((a, b) => a.name.localeCompare(b.name))
    listCalls += 1
    return listCalls % 2 === 0 ? [...annotated].reverse() : annotated
  }

  const resources = () =>
    broken.wrongWidgetMime
      ? RESOURCES.map((r) => (r.uri === WIDGET_URI ? { ...r, mimeType: 'text/plain' } : r))
      : RESOURCES

  /** The MCP endpoint. */
  async function fetchEndpoint(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      const headers = broken.corsMissingHeaders
        ? { ...CORS_HEADERS, 'access-control-allow-headers': 'authorization, content-type' }
        : CORS_HEADERS
      return new Response(null, { status: 204, headers })
    }
    if (request.method === 'GET') {
      if (broken.getReturnsOpenSseStream) {
        // A stream that never closes, exactly like a real keep-alive SSE
        // endpoint. Reading this body to completion hangs forever.
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(': ping\n\n'))
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream', ...CORS_HEADERS },
        })
      }
      if (broken.getReturnsHtml) {
        return new Response('<html><body>hello</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html', ...CORS_HEADERS },
        })
      }
      return rpcError(null, -32000, 'Method not allowed; use POST', 405)
    }
    if (request.method === 'DELETE') {
      if (broken.deleteReturns500) return rpcError(null, -32603, 'boom', 500)
      return new Response(null, { status: 405, headers: CORS_HEADERS })
    }
    if (request.method !== 'POST') return rpcError(null, -32000, 'Method not allowed; use POST', 405)

    if (options.credential) {
      const auth = request.headers.get('authorization')
      if (auth !== `Bearer ${options.credential}`) {
        const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/${segment}"`
        return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, 401, {
          ...(broken.noChallengeHeader ? {} : { 'www-authenticate': challenge }),
        })
      }
    }

    const text = await request.text()
    let message: JsonRpcMessage
    try {
      message = JSON.parse(text) as JsonRpcMessage
    } catch {
      return rpcError(null, -32700, 'Parse error', 400)
    }

    // A notification is an id-less `notifications/*` message: 202, no body.
    const idless = message.id === undefined || message.id === null
    if (idless && typeof message.method === 'string' && message.method.startsWith('notifications/')) {
      if (broken.notificationJsonRpcAnswer) return rpcResult(null, {})
      return new Response(null, { status: 202, headers: CORS_HEADERS })
    }

    // A stateful surface: initialize mints a session id, and every later
    // request must carry it. Not a defect - the legacy transport permits it -
    // so this exercises the probe's handshake rather than a check.
    if (broken.requireSession && message.method !== 'initialize') {
      if (request.headers.get('mcp-session-id') !== 'sess-reference') {
        return rpcError(message.id, -32600, 'Bad Request: session not initialized', 400)
      }
    }

    const era = detectModern(request, message)
    if (era.modern && era.marker && era.marker !== MODERN_VERSION && !broken.downgradeUnknownModernVersion) {
      return rpcError(message.id, -32022, `Unsupported protocol version: ${era.marker}`, 400, {
        supported: [MODERN_VERSION],
      })
    }

    // Header/body validation is modern-only. A legacy request ignores these
    // headers the way it ignores any unknown header.
    if (era.modern || broken.headerMismatchOnLegacy) {
      const declaredMethod = request.headers.get('mcp-method')
      if (declaredMethod && declaredMethod !== message.method) {
        return rpcError(message.id, -32020, 'Mcp-Method does not match the request body', 400)
      }
    }

    const finish = (result: Record<string, unknown>, cacheable = false): Response => {
      if (!era.modern) return rpcResult(message.id, result)
      const stamped: Record<string, unknown> = { ...result }
      if (!broken.noResultType) {
        stamped.resultType = 'complete'
        stamped._meta = { [META_SERVER_INFO]: { name: 'example-mcp-server', version: '1.0.0' } }
      }
      if (cacheable && !broken.noCacheHints) {
        stamped.ttlMs = 60000
        stamped.cacheScope = 'session'
      }
      return rpcResult(message.id, stamped)
    }

    switch (message.method) {
      case 'initialize': {
        const requested = message.params?.protocolVersion
        let echoed: string = LEGACY_LATEST
        if (broken.echoModernFromInitialize) echoed = MODERN_VERSION
        else if (broken.versionEcho) echoed = LEGACY_LATEST
        else if (typeof requested === 'string' && (LEGACY_VERSIONS as readonly string[]).includes(requested)) {
          echoed = requested
        }
        if (broken.plainTextResponse) {
          return new Response('not json', { status: 200, headers: { 'content-type': 'text/plain', ...CORS_HEADERS } })
        }
        return json(
          {
            jsonrpc: '2.0',
            id: message.id ?? null,
            result: {
              protocolVersion: echoed,
              capabilities: capabilities(),
              serverInfo: { name: 'example-mcp-server', version: '1.0.0' },
            },
          },
          200,
          broken.requireSession ? { 'mcp-session-id': 'sess-reference' } : {},
        )
      }
      case 'server/discover':
        if (broken.noServerDiscover) return rpcError(message.id, -32601, 'Method not found')
        return finish({
          protocolVersions: ADVERTISED,
          capabilities: capabilities(),
          serverInfo: { name: 'example-mcp-server', version: '1.0.0' },
        })
      case 'tools/list':
        return finish({ tools: tools() }, true)
      case 'resources/list':
        return finish({ resources: resources() }, true)
      case 'resources/templates/list':
        return finish({ resourceTemplates: [] }, true)
      case 'prompts/list':
        return finish({ prompts: [] }, true)
      case 'logging/setLevel':
        // Declared in `capabilities`, so it must answer. The mutation below is
        // the real-world failure: a surface that advertises `logging` and then
        // answers -32601 is dropped by the reference client at connect time,
        // before any check in this registry gets to run.
        if (broken.loggingSetLevelUnimplemented) return rpcError(message.id, -32601, 'Method not found')
        return finish({})
      case 'tools/call': {
        const name = message.params?.name
        const known = tools().find((tool) => tool.name === name)
        if (!known) return rpcError(message.id, -32602, `Unknown tool: ${String(name)}`)
        const args = (message.params?.arguments ?? {}) as Record<string, unknown>
        const text =
          name === 'alpha' ? `Hello, ${String(args.who ?? 'world')}.` : `Called ${String(name)}.`
        return finish({ content: [{ type: 'text', text }], isError: false })
      }
      case 'resources/read': {
        const uri = message.params?.uri
        const known = resources().find((r) => r.uri === uri)
        if (!known) return rpcError(message.id, -32602, `Unknown resource: ${String(uri)}`)
        // Cacheable: resources/read is one of the five methods the modern era
        // stamps with ttlMs + cacheScope, not just the list methods.
        return finish(
          { contents: [{ uri: known.uri, mimeType: known.mimeType, text: '<html><body>reference</body></html>' }] },
          true,
        )
      }
      default:
        if (broken.unknownMethod500) return rpcError(message.id, -32603, 'boom', 500)
        return rpcError(message.id, -32601, `Method not found: ${String(message.method)}`)
    }
  }

  /** Same-origin non-MCP paths: the discovery documents. */
  async function fetchOrigin(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === path || url.pathname === `${path}/`) return fetchEndpoint(request)

    const prmRoot = '/.well-known/oauth-protected-resource'
    const asRoot = '/.well-known/oauth-authorization-server'
    const prmDocument = {
      resource: `${origin}${path}`,
      authorization_servers: [authorizationServerOrigin],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:tools'],
    }
    const asDocument = {
      issuer: authorizationServerOrigin,
      authorization_endpoint: `${authorizationServerOrigin}/oauth/authorize`,
      token_endpoint: `${authorizationServerOrigin}/oauth/token`,
      registration_endpoint: `${authorizationServerOrigin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: broken.noPkceS256 ? ['plain'] : ['S256'],
      scopes_supported: ['mcp:tools'],
    }

    if (url.pathname === prmRoot) return json(prmDocument)
    if (url.pathname === `${prmRoot}/${segment}`) {
      if (broken.noPathSuffixedPrm) return json({ error: 'not_found' }, 404)
      return json(prmDocument)
    }
    const onAuthorizationServer = url.origin === new URL(authorizationServerOrigin).origin
    if (onAuthorizationServer && (url.pathname === asRoot || url.pathname === `${asRoot}/${segment}`)) {
      if (broken.crossOriginAsRedirect) {
        return new Response(null, { status: 308, headers: { location: `https://auth.elsewhere.test${asRoot}` } })
      }
      return json(asDocument)
    }
    if (onAuthorizationServer && url.pathname === '/.well-known/openid-configuration') return json(asDocument)
    return json({ error: 'not_found' }, 404)
  }

  return { fetch: fetchEndpoint, originFetch: fetchOrigin, origin, path }
}
