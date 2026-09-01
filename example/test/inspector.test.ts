/**
 * The example server, driven by the official MCP Inspector CLI.
 *
 * This is the template's second gate, and it exists because the first one
 * cannot do its job alone. The conformance registry runs OUR checks with OUR
 * probe: it proves a server matches our reading of what each client requires,
 * and it is blind to the case where that reading is wrong. The Inspector is the
 * reference client - the official SDK under a scriptable CLI - so pointing it at
 * a surface asks the one question the registry cannot: does the client everyone
 * debugs against actually work here?
 *
 * The difference is not theoretical. In the codebase this was extracted from,
 * the first run of this file could not get past connect. Every route declared
 * the `logging` capability and answered `logging/setLevel` with -32601, so the
 * Inspector - which calls setLevel because the declaration promises it - dropped
 * the session before its first `tools/list`. Nothing in-house caught it, because
 * an in-house probe only calls methods the server is known to implement. The
 * last test below reproduces that failure on purpose.
 *
 * The suite skips when the CLI is absent and FAILS when `MCP_INSPECTOR_REQUIRED=1`
 * (which `scripts/inspector.ts` and the CI job both set), so the gate cannot go
 * green by testing nothing.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createExampleServer } from 'mcp-conformance/example-server'
import { inspect, requireInspector, serveMcp, strictWarnings, type ServedMcp } from './helpers/inspector.ts'
import { CREDENTIAL, createServer } from '../src/server.ts'

const { bin, skipReason } = requireInspector()

let served: ServedMcp

beforeAll(() => {
  if (!bin) return
  served = serveMcp((request) => createServer().fetch(request))
})

afterAll(() => served?.stop())

describe.skipIf(!bin)(`example server under the MCP Inspector CLI${skipReason ? ` (skipped: ${skipReason})` : ''}`, () => {
  test('lists the tool catalogue', async () => {
    const run = await inspect(served.url, 'tools/list', { token: CREDENTIAL })
    expect(`${run.code}: ${run.stderr}`).toBe(`0: ${run.stderr}`)

    const tools = (run.json?.result?.tools ?? []) as { name: string }[]
    const names = tools.map((tool) => tool.name)
    for (const expected of ['alpha', 'show_panel', 'zeta']) {
      expect(names).toContain(expected)
    }
  })

  test('every tool schema passes the portability lint', async () => {
    const run = await inspect(served.url, 'tools/list', { token: CREDENTIAL, flags: ['--strict'] })

    // Exit 6 is the lint's error-severity verdict; the warnings are the softer
    // findings, and both are held to zero. A warning here names a real client
    // problem - "several MCP clients read `type` as a single string and either
    // reject the tool or drop the constraint" - so it is the reason a nullable
    // output field should be an `anyOf` branch rather than `type: [x, 'null']`.
    expect(strictWarnings(run)).toEqual([])
    expect(`${run.code}: ${run.stderr}`).toBe(`0: ${run.stderr}`)
  })

  test('answers logging/setLevel, which its own capability declaration promises', async () => {
    const run = await inspect(served.url, 'logging/setLevel', {
      token: CREDENTIAL,
      flags: ['--log-level', 'debug'],
    })
    expect(`${run.code}: ${run.stderr}`).toBe(`0: ${run.stderr}`)
    expect(run.json?.error).toBeUndefined()
  })

  test('calls a tool and returns a structured result', async () => {
    const run = await inspect(served.url, 'tools/call', {
      token: CREDENTIAL,
      flags: ['--tool-name', 'alpha', '--tool-arg', 'who=world'],
    })
    expect(`${run.code}: ${run.stderr}`).toBe(`0: ${run.stderr}`)

    const content = (run.json?.result?.content ?? []) as { type: string; text: string }[]
    expect(content[0]?.type).toBe('text')
    expect(content[0]?.text).toContain('Hello, world.')
  })

  test('lists resources, including the MCP Apps widget', async () => {
    const run = await inspect(served.url, 'resources/list', { token: CREDENTIAL })
    expect(`${run.code}: ${run.stderr}`).toBe(`0: ${run.stderr}`)

    const uris = ((run.json?.result?.resources ?? []) as { uri: string }[]).map((r) => r.uri)
    expect(uris.some((uri) => uri.startsWith('ui://'))).toBe(true)
  })

  test('reads a resource', async () => {
    const run = await inspect(served.url, 'resources/read', {
      token: CREDENTIAL,
      flags: ['--uri', 'ui://example/panel'],
    })
    expect(`${run.code}: ${run.stderr}`).toBe(`0: ${run.stderr}`)

    const contents = (run.json?.result?.contents ?? []) as { text?: string }[]
    expect(contents[0]?.text?.length ?? 0).toBeGreaterThan(0)
  })

  test('answers prompts/list, which its own capability declaration promises', async () => {
    const run = await inspect(served.url, 'prompts/list', { token: CREDENTIAL })
    expect(`${run.code}: ${run.stderr}`).toBe(`0: ${run.stderr}`)
    expect(run.json?.result?.prompts).toEqual([])
  })

  test('challenges an unauthenticated client instead of serving it', async () => {
    // `auth_required` is the reference client's verdict after it saw the 401,
    // read the `WWW-Authenticate` challenge and resolved the protected-resource
    // metadata far enough to know an OAuth login is what is missing. A route
    // that just closed the door would fail differently - a transport error, or
    // an empty tool list - so this asserts the discovery chain, not only the
    // refusal. `--stored-auth-only` keeps it deterministic: no TTY, no browser,
    // no interactive fallback.
    const run = await inspect(served.url, 'tools/list', { flags: ['--stored-auth-only'] })
    expect(run.code).not.toBe(0)
    expect(run.json?.error?.code).toBe('auth_required')
  })

  test('a capability declared but not implemented loses the session before tools/list', async () => {
    // The regression this whole job exists for, reproduced. The server below is
    // identical except that `logging/setLevel` answers -32601 while `logging` is
    // still advertised. Every check in the conformance registry still passes
    // against it; the reference client cannot get a tool list out of it.
    const broken = createExampleServer({
      credential: CREDENTIAL,
      break: { loggingSetLevelUnimplemented: true },
    })
    const brokenServer = serveMcp((request) => broken.fetch(request))
    try {
      const run = await inspect(brokenServer.url, 'tools/list', { token: CREDENTIAL })
      expect(run.code).not.toBe(0)
      expect(run.json?.result?.tools).toBeUndefined()
    } finally {
      brokenServer.stop()
    }
  })
})
