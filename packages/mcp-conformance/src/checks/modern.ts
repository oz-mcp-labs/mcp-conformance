/**
 * Modern-era (2026-07-28) checks.
 *
 * `docs/dual-era-policy.md` makes the modern revision the primary target
 * for every MCP surface in this repo, with the legacy revisions as fallback.
 * These checks are the executable form of that document's server checklist, so
 * a surface that drifts back to legacy-only fails a test rather than a review.
 *
 * Note what is deliberately NOT checked here: that `initialize` can reach the
 * modern era. It cannot, by design - `initialize` is always a legacy request
 * and 2026-07-28 is not in the legacy echo set. A surface that answered
 * `2026-07-28` to an `initialize` would be the bug.
 */

import { jsonRpcErrorCode, jsonRpcResult } from '../probe.ts'
import type { Check, CheckContext, CheckResult } from '../types.ts'

const MODERN = '2026-07-28'
const META_VERSION = 'io.modelcontextprotocol/protocolVersion'
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo'

/** Methods that only exist in the modern era, and so are an era signal on their own. */
const MODERN_ONLY_METHODS = ['server/discover', 'subscriptions/listen']

function modernHeaders(revision = MODERN): Record<string, string> {
  return { 'mcp-protocol-version': revision }
}

export const serverDiscover: Check = {
  id: 'server-discover',
  title: 'server/discover advertises every supported revision',
  requirement:
    'server/discover returns protocolVersions listing every revision the surface speaks, newest first, across both eras.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.rpc('server/discover', undefined, { headers: modernHeaders() })
    const { result, problem } = jsonRpcResult(res)
    if (!result) {
      return ctx.fail(
        `server/discover failed: ${problem}`,
        'Implement server/discover (docs/dual-era-policy.md, server checklist item 3). It is how a modern client learns the surface exists without the initialize lifecycle.',
      )
    }
    const versions = result.protocolVersions
    if (!Array.isArray(versions) || versions.length === 0) {
      return ctx.fail(
        'server/discover returned no protocolVersions array',
        'Return protocolVersions as a newest-first array of every revision the surface speaks.',
      )
    }
    const strings = versions.map(String)
    if (strings[0] !== MODERN) {
      return ctx.fail(
        `protocolVersions leads with ${strings[0]}, expected ${MODERN}`,
        `List revisions newest-first so a client that naively takes the head lands on ${MODERN}.`,
      )
    }
    const legacy = strings.filter((v) => v < MODERN)
    if (legacy.length === 0) {
      return ctx.fail(
        `protocolVersions advertises only modern revisions: ${strings.join(', ')}`,
        'Advertise both eras. Listing only the modern revision tells a negotiating client that legacy is unavailable, and contradicts the .well-known documents.',
      )
    }
    const sorted = [...strings].sort().reverse()
    if (sorted.join(',') !== strings.join(',')) {
      return ctx.fail(
        `protocolVersions is not newest-first: ${strings.join(', ')}`,
        'Sort protocolVersions descending. Revision strings are ISO dates, so a lexicographic descending sort is the correct order.',
      )
    }
    return ctx.pass(`advertises ${strings.join(', ')}`)
  },
}

export const modernResultType: Check = {
  id: 'modern-result-type',
  title: 'modern results carry resultType and serverInfo',
  requirement:
    'A request made in the modern era returns resultType on the result and _meta["io.modelcontextprotocol/serverInfo"].',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.rpc('tools/list', undefined, { headers: modernHeaders() })
    const { result, problem } = jsonRpcResult(res)
    if (!result) {
      return ctx.fail(
        `modern tools/list failed: ${problem}`,
        'Serve tools/list in the modern era when MCP-Protocol-Version carries a modern revision.',
      )
    }
    const missing: string[] = []
    if (result.resultType !== 'complete' && result.resultType !== 'input_required') {
      missing.push(`resultType is ${JSON.stringify(result.resultType)}`)
    }
    const meta = result._meta as Record<string, unknown> | undefined
    if (!meta || meta[META_SERVER_INFO] === undefined) {
      missing.push(`_meta["${META_SERVER_INFO}"] absent`)
    }
    if (missing.length > 0) {
      return ctx.fail(
        `modern result is not stamped: ${missing.join('; ')}`,
        'Stamp every modern result with resultType ("complete", or "input_required" where MRTR applies) and _meta serverInfo (docs/dual-era-policy.md, server checklist item 4).',
      )
    }
    return ctx.pass('resultType and _meta serverInfo present')
  },
}

export const modernCacheHints: Check = {
  id: 'modern-cache-hints',
  title: 'modern list and read results carry ttlMs and cacheScope',
  requirement:
    'All five cacheable methods - tools/list, prompts/list, resources/list, resources/templates/list, and resources/read - carry ttlMs and cacheScope in the modern era.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const missing: string[] = []
    const checked: string[] = []
    const unimplemented: string[] = []

    /**
     * A method the surface does not implement answers -32601, and that is not a
     * cache-hint failure - the policy is explicit that an unimplemented method
     * answers -32601 like any other. Only a method that DOES answer is held to
     * the hints, so a surface is never marked non-conformant for declining to
     * serve prompts or resource templates.
     */
    const probe = async (method: string, params?: unknown): Promise<void> => {
      const res = await ctx.rpc(method, params, { headers: modernHeaders() })
      if (jsonRpcErrorCode(res) === -32601) {
        unimplemented.push(method)
        return
      }
      const { result, problem } = jsonRpcResult(res)
      if (!result) {
        missing.push(`${method}: ${problem}`)
        return
      }
      checked.push(method)
      if (typeof result.ttlMs !== 'number') missing.push(`${method}: no numeric ttlMs`)
      if (typeof result.cacheScope !== 'string') missing.push(`${method}: no cacheScope`)
    }

    for (const method of ['tools/list', 'resources/list', 'prompts/list', 'resources/templates/list']) {
      await probe(method)
    }

    // resources/read needs a target. Read the first listed resource when there
    // is one; a surface with no resources simply has nothing to read.
    const listed = await ctx.rpc('resources/list', undefined, { headers: modernHeaders() })
    const resources = jsonRpcResult(listed).result?.resources
    const firstUri = Array.isArray(resources)
      ? (resources.find((r): r is { uri: string } => typeof (r as { uri?: unknown }).uri === 'string')?.uri)
      : undefined
    if (firstUri) await probe('resources/read', { uri: firstUri })

    if (missing.length > 0) {
      return ctx.fail(
        `cache hints absent: ${missing.join('; ')}`,
        'Add ttlMs and cacheScope to every one of the five modern list/read methods the surface implements. Without them a stateless client re-lists on every turn, which is the cost the modern era exists to remove.',
      )
    }
    const note = unimplemented.length > 0 ? `; ${unimplemented.join(', ')} answer -32601 and are not held to it` : ''
    return ctx.pass(`ttlMs and cacheScope present on ${checked.join(', ')}${note}`)
  },
}

export const modernUnsupportedVersionRejected: Check = {
  id: 'modern-unsupported-version-rejected',
  title: 'an unsupported modern version is rejected, never downgraded',
  requirement:
    'A request whose version marker sorts at or above the modern floor but is not supported is answered -32022, with a supported list - never served a legacy response.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const failures: string[] = []
    // `banana` and `draft` are the real regression: a shape-gated comparison
    // that first requires YYYY-MM-DD silently drops them into the legacy
    // branch. Compared lexicographically on the raw string they sort above the
    // modern floor and must be rejected.
    for (const marker of ['2099-01-01', 'banana', 'draft']) {
      const res = await ctx.rpc('tools/list', undefined, { headers: modernHeaders(marker) })
      const code = jsonRpcErrorCode(res)
      if (code !== -32022) {
        const { result } = jsonRpcResult(res)
        failures.push(
          `${marker}: expected -32022, got ${code === undefined ? (result ? 'a successful result' : `HTTP ${res.status}`) : `code ${code}`}`,
        )
      }
    }
    if (failures.length > 0) {
      return ctx.fail(
        `unsupported modern markers were not rejected: ${failures.join('; ')}`,
        'Compare version markers lexicographically on the raw string, without first gating on a YYYY-MM-DD shape, and answer -32022 UnsupportedProtocolVersion with a supported list. Shape-gating is how the TypeScript hosted runtime silently downgraded MCP-Protocol-Version: banana while the Python one rejected it.',
      )
    }
    return ctx.pass('2099-01-01, banana, and draft all answered -32022')
  },
}

export const legacyIgnoresModernHeaders: Check = {
  id: 'legacy-ignores-modern-headers',
  title: 'a legacy request ignores Mcp-Method / Mcp-Name',
  requirement:
    'A legacy-era request carrying a mismatched Mcp-Method or Mcp-Name is served normally. Those headers do not exist in the legacy revisions, and -32020 is a code no legacy client can interpret.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.rpc('tools/list', undefined, {
      headers: { 'mcp-protocol-version': '2025-06-18', 'mcp-method': 'resources/list', 'mcp-name': 'nope' },
    })
    const { result, problem } = jsonRpcResult(res)
    if (!result) {
      return ctx.fail(
        `legacy tools/list rejected the modern headers: ${problem} (HTTP ${res.status})`,
        'Gate the Mcp-Method / Mcp-Name mismatch check on the detected era. Running it era-agnostically makes a modern-aware client that fell back to the legacy lifecycle - but kept sending the headers - eat 400s.',
      )
    }
    return ctx.pass('legacy request served despite a mismatched Mcp-Method and Mcp-Name')
  },
}

export { MODERN_ONLY_METHODS, MODERN, META_VERSION }
