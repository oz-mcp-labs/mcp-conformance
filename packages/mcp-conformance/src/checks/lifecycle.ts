/**
 * Legacy-era lifecycle checks: `initialize`, notification acks, and the
 * `MCP-Protocol-Version` header every 2025-06-18-or-later client sends on
 * post-initialize requests.
 *
 * These are the checks that would have caught the two bugs
 * `docs/evidence/grok-connector.md` section 2 records: every hand-rolled surface
 * answered `initialize` with its own `PROTOCOL_VERSION` regardless of what the
 * client asked for, and answered id-less `notifications/*` with a JSON-RPC
 * response instead of `202 Accepted`.
 */

import { jsonRpcErrorCode, jsonRpcResult } from '../probe.ts'
import type { Check, CheckContext, CheckResult } from '../types.ts'

/** Revisions probed when a requirement does not name its own. */
const DEFAULT_REVISIONS = ['2025-03-26', '2025-06-18', '2025-11-25'] as const

function initializeParams(protocolVersion: string) {
  return {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'mcp-conformance', version: '0.1.0' },
  }
}

export const initializeVersionEcho: Check = {
  id: 'initialize-version-echo',
  title: 'initialize echoes the requested protocol revision',
  requirement:
    'For every revision the server supports, `initialize` returns that same revision - never a newer one.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const revisions = ctx.requirement.params?.revisions ?? DEFAULT_REVISIONS
    const mismatches: string[] = []
    for (const revision of revisions) {
      const res = await ctx.rpc('initialize', initializeParams(revision))
      const { result, problem } = jsonRpcResult(res)
      if (!result) {
        mismatches.push(`${revision}: ${problem}`)
        continue
      }
      const echoed = result.protocolVersion
      if (echoed !== revision) {
        mismatches.push(`asked ${revision}, got ${JSON.stringify(echoed)}`)
      }
    }
    if (mismatches.length > 0) {
      return ctx.fail(
        `protocol negotiation diverged: ${mismatches.join('; ')}`,
        'Route the `initialize` answer through one shared version-negotiation helper so a supported requested revision is echoed verbatim. A client pinned to an older revision reads a newer answer as "server does not speak my version" and disconnects.',
      )
    }
    return ctx.pass(`echoed every requested revision: ${revisions.join(', ')}`)
  },
}

export const initializeUnsupportedVersionFallback: Check = {
  id: 'initialize-unsupported-version-fallback',
  title: 'initialize answers an unknown revision with a supported one',
  requirement:
    'An `initialize` naming a revision the server does not support returns the server\'s latest supported revision, not a JSON-RPC error.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.rpc('initialize', initializeParams('1990-01-01'))
    const { result, problem } = jsonRpcResult(res)
    if (!result) {
      return ctx.fail(
        `unknown revision produced ${problem}`,
        'Fall back to the latest supported revision instead of erroring. The legacy spec makes the client decide whether it can live with the offered revision; erroring removes that choice and strands clients that would have proceeded.',
      )
    }
    const echoed = result.protocolVersion
    if (typeof echoed !== 'string' || echoed === '1990-01-01') {
      return ctx.fail(
        `expected a real supported revision, got ${JSON.stringify(echoed)}`,
        'Return the server\'s own latest supported revision when the requested one is unknown - never echo an unsupported value back, which claims support the transport does not have.',
      )
    }
    return ctx.pass(`fell back to ${echoed}`)
  },
}

export const initializeServerInfo: Check = {
  id: 'initialize-server-info',
  title: 'initialize returns serverInfo and capabilities',
  requirement: '`initialize` returns a `serverInfo` with a non-empty `name`, and a `capabilities` object.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.rpc('initialize', initializeParams('2025-11-25'))
    const { result, problem } = jsonRpcResult(res)
    if (!result) return ctx.fail(`initialize failed: ${problem}`, 'Implement the legacy `initialize` lifecycle.')
    const serverInfo = result.serverInfo as { name?: unknown; version?: unknown } | undefined
    if (!serverInfo || typeof serverInfo.name !== 'string' || serverInfo.name.length === 0) {
      return ctx.fail(
        'initialize returned no `serverInfo.name`',
        'Return `serverInfo: { name, version }`. Clients label the connector with it; an empty name renders as an unnamed server in every connector UI.',
      )
    }
    if (typeof result.capabilities !== 'object' || result.capabilities === null) {
      return ctx.fail(
        'initialize returned no `capabilities` object',
        'Return a `capabilities` object, even if only `{ tools: {} }`. A client that sees none may skip `tools/list` entirely.',
      )
    }
    return ctx.pass(`serverInfo.name=${serverInfo.name} version=${String(serverInfo.version ?? 'unset')}`)
  },
}

export const notificationAck202: Check = {
  id: 'notification-ack-202',
  title: 'id-less notifications/* are answered 202 with no body',
  requirement:
    'A `notifications/*` message with no `id` gets HTTP 202 and an empty body - never a JSON-RPC response.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.notify('notifications/initialized')
    if (res.error) return ctx.fail(`request failed: ${res.error}`, 'Accept id-less notification posts.')
    if (res.status !== 202) {
      return ctx.fail(
        `expected HTTP 202, got ${res.status}`,
        'Answer an id-less `notifications/*` message with `202 Accepted` and an empty body. Sending a JSON-RPC response to a notification is a transport violation that stricter clients surface as a connection error.',
      )
    }
    if (res.text.trim().length > 0) {
      return ctx.fail(
        `202 carried a body: ${res.text.slice(0, 120)}`,
        'Return an empty body with the 202. A JSON-RPC envelope with a null id is still a response to something that was not a request.',
      )
    }
    return ctx.pass('202 Accepted with an empty body')
  },
}

export const protocolVersionHeaderTolerated: Check = {
  id: 'protocol-version-header-tolerated',
  title: 'a legacy MCP-Protocol-Version header is accepted',
  requirement:
    'A post-initialize request carrying `MCP-Protocol-Version: <legacy revision>` is served normally - the header is required of 2025-06-18-and-later clients, so rejecting it breaks every one of them.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const failures: string[] = []
    for (const revision of ['2025-06-18', '2025-11-25']) {
      const res = await ctx.rpc('tools/list', undefined, {
        headers: { 'mcp-protocol-version': revision },
      })
      const { result, problem } = jsonRpcResult(res)
      if (!result) failures.push(`${revision}: ${problem}`)
    }
    if (failures.length > 0) {
      return ctx.fail(
        `tools/list rejected a legacy version header: ${failures.join('; ')}`,
        'Accept `MCP-Protocol-Version` carrying any supported legacy revision. Header presence is not an era signal - only its value is (docs/dual-era-policy.md, "Era detection").',
      )
    }
    return ctx.pass('served tools/list under MCP-Protocol-Version 2025-06-18 and 2025-11-25')
  },
}

export const unknownMethodErrorCode: Check = {
  id: 'unknown-method-error-code',
  title: 'an unimplemented method answers -32601',
  requirement: 'A method the server does not implement returns JSON-RPC error -32601, not a 404 or a 500.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.rpc('conformance/definitely-not-a-method')
    const code = jsonRpcErrorCode(res)
    if (code === -32601) return ctx.pass('answered -32601 Method not found')
    if (res.status >= 500) {
      return ctx.fail(
        `unknown method produced HTTP ${res.status}`,
        'Answer an unrecognised method with JSON-RPC error -32601. A 5xx makes a client retry and then mark the server unhealthy.',
      )
    }
    return ctx.fail(
      `expected -32601, got HTTP ${res.status}${code === undefined ? '' : ` / code ${code}`}`,
      'Answer an unrecognised method with JSON-RPC error -32601 (Method not found) on a 200.',
    )
  },
}

export const initializeDeclaresToolsCapability: Check = {
  id: 'initialize-declares-tools-capability',
  title: 'initialize declares the tools capability',
  requirement:
    'A server that serves tools declares `capabilities.tools` on `initialize`. The official TypeScript SDK gates `tools/list` on it and refuses to call the method otherwise.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.rpc('initialize', initializeParams('2025-11-25'))
    const { result, problem } = jsonRpcResult(res)
    if (!result) return ctx.fail(`initialize failed: ${problem}`, 'Implement the legacy initialize lifecycle.')
    const capabilities = result.capabilities as Record<string, unknown> | undefined
    if (!capabilities || capabilities.tools === undefined) {
      return ctx.fail(
        'initialize did not declare capabilities.tools',
        'Declare `capabilities: { tools: {} }` (plus `resources` / `prompts` where served). A client built on the official SDK asserts the capability before calling the method, so an undeclared capability means the tool catalog is never requested at all - the server looks empty rather than broken.',
      )
    }
    return ctx.pass(`declares ${Object.keys(capabilities).join(', ')}`)
  },
}

export const initializeNeverEchoesModernRevision: Check = {
  id: 'initialize-never-echoes-modern-revision',
  title: 'initialize never answers with a modern-era revision',
  requirement:
    'An `initialize` asking for 2026-07-28 is answered with the latest legacy revision, never 2026-07-28 itself.',
  async run(ctx: CheckContext): Promise<CheckResult> {
    const res = await ctx.rpc('initialize', initializeParams('2026-07-28'))
    const { result, problem } = jsonRpcResult(res)
    if (!result) {
      return ctx.fail(
        `initialize with a modern revision produced ${problem}`,
        'Fall back to the latest supported legacy revision rather than erroring. `initialize` is always a legacy request; a modern-aware client that opens with it expects a legacy answer.',
      )
    }
    const echoed = String(result.protocolVersion)
    if (echoed >= '2026-07-28') {
      return ctx.fail(
        `initialize echoed ${echoed}`,
        'Answer `initialize` with the latest supported legacy revision. The modern revision is not in the legacy echo set, and a client on the official SDK 1.x hard-throws "Server\'s protocol version is not supported" on a revision outside its own list - which is every 1.x client, mcp-remote included.',
      )
    }
    return ctx.pass(`answered ${echoed} to a 2026-07-28 initialize, as the legacy lifecycle requires`)
  },
}
