/**
 * Catalog-shape checks: what `tools/list` and `resources/list` return, and
 * whether the tool names, descriptions, and count fit inside the limits a
 * particular client imposes.
 *
 * The limits are per-profile parameters rather than constants here, because
 * they are exactly the kind of fact that differs per client and that we must
 * be able to cite. A profile that cannot source a limit does not carry the
 * requirement at all - it carries an `unknown` instead.
 */

import { jsonRpcResult } from '../probe.ts'
import type { Check, CheckContext, CheckResult } from '../types.ts'

interface ListedTool {
  name?: unknown
  description?: unknown
  inputSchema?: unknown
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

interface ListedResource {
  uri?: unknown
  name?: unknown
  mimeType?: unknown
  _meta?: Record<string, unknown>
}

async function listTools(ctx: CheckContext): Promise<{ tools?: ListedTool[]; problem?: string }> {
  const res = await ctx.rpc('tools/list')
  const { result, problem } = jsonRpcResult(res)
  if (!result) return { problem }
  if (!Array.isArray(result.tools)) return { problem: 'result.tools is not an array' }
  return { tools: result.tools as ListedTool[] }
}

async function listResources(ctx: CheckContext): Promise<{ resources?: ListedResource[]; problem?: string }> {
  const res = await ctx.rpc('resources/list')
  const { result, problem } = jsonRpcResult(res)
  if (!result) return { problem }
  if (!Array.isArray(result.resources)) return { problem: 'result.resources is not an array' }
  return { resources: result.resources as ListedResource[] }
}

export const toolsListShape: Check = {
  id: 'tools-list-shape',
  title: 'tools/list returns well-formed tool descriptors',
  requirement:
    'Every entry has a non-empty string name and an object inputSchema with type "object".',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const { tools, problem } = await listTools(ctx)
    if (!tools) {
      return ctx.fail(
        `tools/list failed: ${problem}`,
        'Implement tools/list returning { tools: [...] }. Every client calls it immediately after the handshake; a failure here means zero tools regardless of what the server can do.',
      )
    }
    const bad: string[] = []
    for (const [index, tool] of tools.entries()) {
      const label = typeof tool.name === 'string' ? tool.name : `#${index}`
      if (typeof tool.name !== 'string' || tool.name.length === 0) {
        bad.push(`${label}: missing string name`)
        continue
      }
      const schema = tool.inputSchema as { type?: unknown } | undefined
      if (typeof schema !== 'object' || schema === null) {
        bad.push(`${label}: missing inputSchema object`)
      } else if (schema.type !== 'object') {
        bad.push(`${label}: inputSchema.type is ${JSON.stringify(schema.type)}, expected "object"`)
      }
    }
    if (bad.length > 0) {
      return ctx.fail(
        `${bad.length} of ${tools.length} tool descriptors are malformed: ${bad.slice(0, 5).join('; ')}`,
        'Emit { name, description, inputSchema: { type: "object", properties, required } } for every tool. Clients that validate the descriptor drop the whole catalog, not just the offending entry.',
      )
    }
    return ctx.pass(`${tools.length} tool descriptors, all well-formed`)
  },
}

export const toolsListDeterministicOrder: Check = {
  id: 'tools-list-deterministic-order',
  title: 'tools/list ordering is stable across calls',
  requirement: 'Two consecutive tools/list calls return the same tools in the same order.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const first = await listTools(ctx)
    if (!first.tools) return ctx.fail(`tools/list failed: ${first.problem}`, 'Implement tools/list.')
    const second = await listTools(ctx)
    if (!second.tools) return ctx.fail(`second tools/list failed: ${second.problem}`, 'Implement tools/list.')
    const a = first.tools.map((t) => String(t.name))
    const b = second.tools.map((t) => String(t.name))
    if (a.join(' ') !== b.join(' ')) {
      return ctx.fail(
        `ordering changed between calls: [${a.slice(0, 6).join(', ')}] then [${b.slice(0, 6).join(', ')}]`,
        'Sort the catalog deterministically before returning it. The spec states it as a SHOULD, and a stable order also keeps client-side prompt caches warm instead of invalidating them on every list.',
      )
    }
    return ctx.pass(`stable order across two calls (${a.length} tools)`)
  },
}

export const resourcesListShape: Check = {
  id: 'resources-list-shape',
  title: 'resources/list returns well-formed resource descriptors',
  requirement:
    'resources/list succeeds and every entry has a non-empty string uri. A server with no resources returns an empty array, not an error.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const { resources, problem } = await listResources(ctx)
    if (!resources) {
      return ctx.fail(
        `resources/list failed: ${problem}`,
        'Implement resources/list returning { resources: [] } when there are none. Erroring is indistinguishable from an unhealthy server, and it is what makes an MCP Apps widget link look dangling.',
      )
    }
    const bad = resources
      .map((r, i) => (typeof r.uri === 'string' && r.uri.length > 0 ? null : `#${i}`))
      .filter((x): x is string => x !== null)
    if (bad.length > 0) {
      return ctx.fail(
        `${bad.length} resource descriptors have no uri: ${bad.join(', ')}`,
        'Give every resource a stable uri. It is the only handle a client has for resources/read.',
      )
    }
    return ctx.pass(`${resources.length} resource descriptors, all with a uri`)
  },
}

export const toolNameLimit: Check = {
  id: 'tool-name-limit',
  title: 'tool names fit the client limit',
  requirement:
    'Every tool name is within the client maximum length and matches its accepted character class.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const max = ctx.requirement.params?.maxToolNameLength
    const pattern = ctx.requirement.params?.toolNamePattern
    if (max === undefined && pattern === undefined) {
      return ctx.skip('profile declares no tool-name limit to check against')
    }
    const { tools, problem } = await listTools(ctx)
    if (!tools) return ctx.fail(`tools/list failed: ${problem}`, 'Implement tools/list.')
    const re = pattern ? new RegExp(pattern) : undefined
    const violations: string[] = []
    for (const tool of tools) {
      const name = String(tool.name)
      if (max !== undefined && name.length > max) violations.push(`${name} (${name.length} > ${max})`)
      else if (re && !re.test(name)) violations.push(`${name} (does not match ${pattern})`)
    }
    if (violations.length > 0) {
      return ctx.fail(
        `${violations.length} tool names violate the ${ctx.profile.displayName} limit: ${violations.slice(0, 5).join('; ')}`,
        `Rename the offending tools to at most ${max ?? 'the documented'} characters${pattern ? ` matching ${pattern}` : ''}. A client that validates names typically rejects the entire catalog, not the single tool.`,
      )
    }
    const longest = tools.reduce((n, t) => Math.max(n, String(t.name).length), 0)
    return ctx.pass(`${tools.length} tool names, longest ${longest}${max === undefined ? '' : `/${max}`}`)
  },
}

export const toolDescriptionLimit: Check = {
  id: 'tool-description-limit',
  title: 'tool descriptions fit the client limit',
  requirement: 'No tool description exceeds the documented client maximum length.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const max = ctx.requirement.params?.maxToolDescriptionLength
    if (max === undefined) return ctx.skip('profile declares no tool-description limit to check against')
    const { tools, problem } = await listTools(ctx)
    if (!tools) return ctx.fail(`tools/list failed: ${problem}`, 'Implement tools/list.')
    const violations = tools
      .filter((t) => typeof t.description === 'string' && t.description.length > max)
      .map((t) => `${String(t.name)} (${String(t.description).length} > ${max})`)
    if (violations.length > 0) {
      return ctx.fail(
        `${violations.length} descriptions exceed ${max} characters: ${violations.slice(0, 5).join('; ')}`,
        `Shorten the descriptions to ${max} characters or fewer, moving detail into the input schema per-field descriptions or into a prompt or resource.`,
      )
    }
    const longest = tools.reduce(
      (n, t) => Math.max(n, typeof t.description === 'string' ? t.description.length : 0),
      0,
    )
    return ctx.pass(`longest description ${longest}/${max}`)
  },
}

export const toolCountLimit: Check = {
  id: 'tool-count-limit',
  title: 'the tool count fits the client limit',
  requirement: 'The catalog size is within what the client will load.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const max = ctx.requirement.params?.maxToolCount
    if (max === undefined) return ctx.skip('profile declares no tool-count limit to check against')
    const { tools, problem } = await listTools(ctx)
    if (!tools) return ctx.fail(`tools/list failed: ${problem}`, 'Implement tools/list.')
    if (tools.length > max) {
      return ctx.fail(
        `${tools.length} tools exceeds the ${ctx.profile.displayName} limit of ${max}`,
        `Reduce the exposed catalog to ${max} tools or fewer - scope-filter per credential, or put the surface behind a gateway in search mode so the client sees meta-tools instead of the full catalog.`,
      )
    }
    return ctx.pass(`${tools.length}/${max} tools`)
  },
}

const UI_EXTENSION = 'io.modelcontextprotocol/ui'

export const mcpAppsUiExtension: Check = {
  id: 'mcp-apps-ui-extension',
  title: 'the MCP Apps UI extension is advertised',
  requirement:
    'initialize advertises capabilities.extensions["io.modelcontextprotocol/ui"], so a UI-capable client knows to look for _meta.ui on tools.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'mcp-conformance', version: '0.1.0' },
    })
    const { result, problem } = jsonRpcResult(res)
    if (!result) return ctx.fail(`initialize failed: ${problem}`, 'Implement the legacy initialize lifecycle.')
    const capabilities = result.capabilities as { extensions?: Record<string, unknown> } | undefined
    if (!capabilities?.extensions || !(UI_EXTENSION in capabilities.extensions)) {
      return ctx.fail(
        `initialize capabilities do not include extensions["${UI_EXTENSION}"]`,
        `Advertise capabilities.extensions: { "${UI_EXTENSION}": {} } on both the legacy and the modern path (docs/dual-era-policy.md, server checklist item 6). Without it a UI-capable client never looks for widget links.`,
      )
    }
    return ctx.pass(`advertises extensions["${UI_EXTENSION}"]`)
  },
}

export const mcpAppsUiResourceResolvable: Check = {
  id: 'mcp-apps-ui-resource-resolvable',
  title: 'every tool widget link resolves to a listed resource',
  requirement:
    'Each _meta.ui / openai/outputTemplate resource URI a tool points at appears in resources/list and reads back with content.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const { tools, problem } = await listTools(ctx)
    if (!tools) return ctx.fail(`tools/list failed: ${problem}`, 'Implement tools/list.')

    const links: { tool: string; uri: string }[] = []
    for (const tool of tools) {
      const meta = tool._meta
      if (!meta) continue
      const ui = meta[UI_EXTENSION] as { resourceUri?: unknown; uri?: unknown } | undefined
      const fromUi =
        typeof ui?.resourceUri === 'string' ? ui.resourceUri : typeof ui?.uri === 'string' ? ui.uri : undefined
      const openai = meta['openai/outputTemplate']
      const candidate = fromUi ?? (typeof openai === 'string' ? openai : undefined)
      if (candidate) links.push({ tool: String(tool.name), uri: candidate })
    }
    if (links.length === 0) return ctx.skip('no tool declares a widget resource link')

    const { resources, problem: resourceProblem } = await listResources(ctx)
    if (!resources) {
      return ctx.fail(
        `${links.length} tools link a widget but resources/list failed: ${resourceProblem}`,
        'A widget link is only usable if resources/list enumerates the target. Implement resources/list, or drop the _meta link.',
      )
    }
    const listed = new Set(resources.map((r) => String(r.uri)))
    const dangling = links.filter((l) => !listed.has(l.uri))
    if (dangling.length > 0) {
      return ctx.fail(
        `${dangling.length} widget links point at unlisted resources: ${dangling
          .slice(0, 5)
          .map((d) => `${d.tool} -> ${d.uri}`)
          .join('; ')}`,
        'List every widget resource in resources/list. A client resolves the link through the resource catalog; an unlisted URI renders as a tool with a broken widget rather than a plain text result.',
      )
    }

    const unreadable: string[] = []
    for (const link of links.slice(0, 5)) {
      const read = await ctx.rpc('resources/read', { uri: link.uri })
      const { result, problem: readProblem } = jsonRpcResult(read)
      const contents = result?.contents
      if (!result || !Array.isArray(contents) || contents.length === 0) {
        unreadable.push(`${link.uri}: ${readProblem ?? 'no contents'}`)
      }
    }
    if (unreadable.length > 0) {
      return ctx.fail(
        `widget resources do not read back: ${unreadable.join('; ')}`,
        'Make resources/read return { contents: [{ uri, mimeType, text }] } for every widget URI.',
      )
    }
    return ctx.pass(`${links.length} widget links, all listed and readable`)
  },
}

export const toolAnnotationsPresent: Check = {
  id: 'tool-annotations-present',
  title: 'tools carry explicit OpenAI safety annotations',
  requirement:
    'Every tool declares boolean annotations.readOnlyHint, annotations.destructiveHint, and annotations.openWorldHint. OpenAI requires all three when it scans an MCP catalog.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const { tools, problem } = await listTools(ctx)
    if (!tools) return ctx.fail(`tools/list failed: ${problem}`, 'Implement tools/list.')
    const missing: string[] = []
    for (const tool of tools) {
      const annotations = tool.annotations
      const name = String(tool.name)
      if (!annotations || typeof annotations !== 'object') {
        missing.push(`${name}: no annotations`)
        continue
      }
      const gaps = ['readOnlyHint', 'destructiveHint', 'openWorldHint'].filter(
        (key) => typeof annotations[key] !== 'boolean',
      )
      if (gaps.length > 0) missing.push(`${name}: missing ${gaps.join(' + ')}`)
    }
    if (missing.length > 0) {
      return ctx.fail(
        `${missing.length} of ${tools.length} tools lack required annotations: ${missing.slice(0, 5).join('; ')}`,
        'Emit boolean readOnlyHint, destructiveHint, and openWorldHint on every tool. Preserve author declarations and materialize conservative values for omitted hints.',
      )
    }
    return ctx.pass(`${tools.length} tools all carry the three explicit safety annotations`)
  },
}

/** Widget resource media types clients accept. The second is OpenAI's legacy spelling. */
const WIDGET_MIME_TYPES = ['text/html;profile=mcp-app', 'text/html+skybridge']

function normalizeMime(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase()
}

export const mcpAppsWidgetMimeType: Check = {
  id: 'mcp-apps-widget-mime-type',
  title: 'widget resources declare an accepted HTML media type',
  requirement:
    'A resource a tool links as its widget declares mimeType text/html;profile=mcp-app (or the legacy text/html+skybridge that OpenAI examples still ship).',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const { tools, problem } = await listTools(ctx)
    if (!tools) return ctx.fail(`tools/list failed: ${problem}`, 'Implement tools/list.')
    const linked = new Set<string>()
    for (const tool of tools) {
      const meta = tool._meta
      if (!meta) continue
      const ui = meta[UI_EXTENSION] as { resourceUri?: unknown } | undefined
      if (typeof ui?.resourceUri === 'string') linked.add(ui.resourceUri)
      const flat = meta['ui/resourceUri']
      if (typeof flat === 'string') linked.add(flat)
      const openai = meta['openai/outputTemplate']
      if (typeof openai === 'string') linked.add(openai)
    }
    if (linked.size === 0) return ctx.skip('no tool declares a widget resource link')

    const { resources, problem: resourceProblem } = await listResources(ctx)
    if (!resources) return ctx.fail(`resources/list failed: ${resourceProblem}`, 'Implement resources/list.')

    const wrong: string[] = []
    for (const resource of resources) {
      const uri = String(resource.uri)
      if (!linked.has(uri)) continue
      const mime = normalizeMime(resource.mimeType)
      if (!WIDGET_MIME_TYPES.includes(mime)) wrong.push(`${uri}: ${resource.mimeType ?? '(none)'}`)
    }
    if (wrong.length > 0) {
      return ctx.fail(
        `${wrong.length} widget resources declare an unusable media type: ${wrong.join('; ')}`,
        `Declare mimeType "${WIDGET_MIME_TYPES[0]}" on every resource a tool links as its widget. A host that does not recognise the media type renders the tool result as plain structured content and never mounts the component.`,
      )
    }
    return ctx.pass(`${linked.size} widget resources all declare an accepted media type`)
  },
}

/**
 * OpenAI's deep-research and company-knowledge surfaces do not consume an
 * arbitrary MCP catalog: they call exactly two tools, `search` and `fetch`,
 * with a fixed input and output shape. A server without them is not "partly
 * compatible" - the model will not call it at all.
 */
export const deepResearchSearchFetchContract: Check = {
  id: 'deep-research-search-fetch-contract',
  title: 'search and fetch tools match the deep-research contract',
  requirement:
    'The server exposes a `search` tool taking a single string `query` and a `fetch` tool taking a single string `id`, both read-only.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const { tools, problem } = await listTools(ctx)
    if (!tools) return ctx.fail(`tools/list failed: ${problem}`, 'Implement tools/list.')
    const byName = new Map(tools.map((t) => [String(t.name), t]))

    const problems: string[] = []
    for (const [name, field] of [
      ['search', 'query'],
      ['fetch', 'id'],
    ] as const) {
      const tool = byName.get(name)
      if (!tool) {
        problems.push(`no \`${name}\` tool`)
        continue
      }
      const schema = tool.inputSchema as { properties?: Record<string, { type?: unknown }> } | undefined
      const property = schema?.properties?.[field]
      if (!property) problems.push(`${name}: input schema has no \`${field}\` property`)
      else if (property.type !== 'string') problems.push(`${name}.${field} is ${JSON.stringify(property.type)}, expected "string"`)
    }
    if (problems.length > 0) {
      return ctx.fail(
        `deep-research contract unmet: ${problems.join('; ')}`,
        'Expose a `search(query: string)` tool returning { results: [{ id, title, url }] } and a `fetch(id: string)` tool returning { id, title, text, url, metadata? }, each with the object in `structuredContent` AND the same value JSON-encoded in content[0].text. The deep-research model is optimized for exactly this pair and does not call servers that do not implement it.',
      )
    }
    return ctx.pass('search(query: string) and fetch(id: string) both present')
  },
}
