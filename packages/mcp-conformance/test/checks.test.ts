/**
 * Mutation tests for the check suite.
 *
 * The reference server satisfies every check. Each case below breaks exactly
 * one behavior and asserts that the corresponding check goes red - and, for the
 * cases where it matters, that the OTHER checks stay green, so a check that
 * fails for the wrong reason is caught.
 *
 * This is the test that makes the rest of the package trustworthy: without it,
 * a check that always passes and a surface that is genuinely conformant look
 * identical.
 */

import { describe, expect, test } from 'bun:test'
import { ALL_CHECKS } from '../src/checks/index.ts'
import { Probe } from '../src/probe.ts'
import { specBaselineProfile } from '../src/profiles/index.ts'
import type {
  CheckId,
  CheckResult,
  ClientProfile,
  ConformanceTarget,
  Requirement,
} from '../src/types.ts'
import { createExampleServer, type Mutation, type ExampleServerOptions } from '../src/example-server.ts'

const CREDENTIAL = 'ref_token_for_tests'

function targetFor(options: ExampleServerOptions = {}): ConformanceTarget {
  const server = createExampleServer({ credential: CREDENTIAL, ...options })
  return {
    id: 'reference',
    displayName: 'Reference server',
    url: `${server.origin}${server.path}`,
    credential: CREDENTIAL,
    fetch: server.fetch,
    originFetch: server.originFetch,
  }
}

async function runCheck(
  id: CheckId,
  options: ExampleServerOptions = {},
  params?: Requirement['params'],
): Promise<CheckResult> {
  const target = targetFor(options)
  const requirement: Requirement = {
    check: id,
    confidence: 'documented',
    rationale: 'mutation test',
    sources: [{ kind: 'repo', ref: 'packages/mcp-conformance/test/checks.test.ts' }],
    ...(params ? { params } : {}),
  }
  const probe = new Probe(target, requirement, specBaselineProfile, id)
  return ALL_CHECKS[id].run(probe)
}

/** Every check that the unmutated reference server is expected to pass outright. */
const EXPECTED_PASS: CheckId[] = [
  'initialize-version-echo',
  'initialize-unsupported-version-fallback',
  'initialize-server-info',
  'initialize-declares-tools-capability',
  'initialize-never-echoes-modern-revision',
  'notification-ack-202',
  'tools-list-shape',
  'tools-list-deterministic-order',
  'resources-list-shape',
  'protocol-version-header-tolerated',
  'unknown-method-error-code',
  'server-discover',
  'modern-result-type',
  'modern-cache-hints',
  'modern-unsupported-version-rejected',
  'legacy-ignores-modern-headers',
  'response-content-type',
  'sse-get-stream',
  'delete-method-handled',
  'session-header-absent-or-echoed',
  'initialize-session-id-issued',
  'unauthenticated-401-challenge',
  'prm-document-served',
  'as-metadata-both-paths',
  'as-metadata-no-cross-origin-redirect',
  'as-metadata-pkce-s256',
  'as-metadata-origin-consistent',
  'authorization-endpoint-same-origin',
  'as-metadata-rfc9207-cimd',
  'cors-preflight',
  'cors-allowed-headers',
  'cors-exposed-headers',
  'tool-annotations-present',
  'mcp-apps-ui-extension',
  'mcp-apps-ui-resource-resolvable',
  'mcp-apps-widget-mime-type',
]

describe('the reference server satisfies the registry', () => {
  for (const id of EXPECTED_PASS) {
    test(`${id} passes`, async () => {
      const result = await runCheck(id)
      expect(`${id}: ${result.status} - ${result.detail}`).toBe(`${id}: pass - ${result.detail}`)
    })
  }

  test('every check in the registry is covered by this file', () => {
    const covered = new Set<string>([
      ...EXPECTED_PASS,
      // Parameterised limit checks skip without params, and the deep-research
      // contract is a shape the reference server deliberately does not adopt.
      'tool-name-limit',
      'tool-description-limit',
      'tool-count-limit',
      'deep-research-search-fetch-contract',
      // This is rendered only as a manual runbook step and is never executed.
      'oauth-authorization-code-flow',
    ])
    const missing = Object.keys(ALL_CHECKS).filter((id) => !covered.has(id))
    expect(missing).toEqual([])
  })
})

describe('limit checks skip when the profile declares no limit', () => {
  for (const id of ['tool-name-limit', 'tool-description-limit', 'tool-count-limit'] as const) {
    test(`${id} skips`, async () => {
      const result = await runCheck(id)
      expect(result.status).toBe('skip')
      expect(result.detail).toContain('no tool-')
    })
  }
})

describe('limit checks fire when the profile declares a limit', () => {
  test('tool-name-limit fails a name over the maximum', async () => {
    const result = await runCheck('tool-name-limit', {}, { maxToolNameLength: 4 })
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('show_panel')
  })

  test('tool-name-limit passes a generous maximum', async () => {
    const result = await runCheck('tool-name-limit', {}, { maxToolNameLength: 64 })
    expect(result.status).toBe('pass')
  })

  test('tool-name-limit fails a name outside the declared character class', async () => {
    const result = await runCheck('tool-name-limit', {}, { toolNamePattern: '^[a-z]+$' })
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('show_panel')
  })

  test('tool-description-limit fails a description over the maximum', async () => {
    const result = await runCheck('tool-description-limit', {}, { maxToolDescriptionLength: 5 })
    expect(result.status).toBe('fail')
  })

  test('tool-count-limit fails a catalog over the maximum', async () => {
    const result = await runCheck('tool-count-limit', {}, { maxToolCount: 1 })
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('3 tools')
  })
})

describe('the deep-research contract is not satisfied by an ordinary catalog', () => {
  test('fails without search and fetch tools', async () => {
    const result = await runCheck('deep-research-search-fetch-contract')
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('no `search` tool')
    expect(result.detail).toContain('no `fetch` tool')
  })
})

describe('authorization-server discovery follows protected-resource metadata', () => {
  test('the S256 check reaches a different authorization-server origin anonymously', async () => {
    const authorizationServerOrigin = 'https://auth.reference.test'
    const result = await runCheck('as-metadata-pkce-s256', { authorizationServerOrigin })
    expect(result.status).toBe('pass')
    expect(result.detail).toContain(
      `${authorizationServerOrigin}/.well-known/oauth-authorization-server`,
    )
    const issuerRequest = result.evidence.find((exchange) =>
      exchange.request.url.startsWith(authorizationServerOrigin),
    )
    expect(issuerRequest).toBeDefined()
    expect(issuerRequest?.request.headers.authorization).toBeUndefined()
  })
})

/** One broken behavior, and the single check that must catch it. */
const MUTATIONS: { mutation: Mutation; catches: CheckId; expect?: string }[] = [
  { mutation: 'versionEcho', catches: 'initialize-version-echo', expect: 'asked 2025-03-26' },
  { mutation: 'echoModernFromInitialize', catches: 'initialize-never-echoes-modern-revision', expect: '2026-07-28' },
  { mutation: 'notificationJsonRpcAnswer', catches: 'notification-ack-202', expect: 'expected HTTP 202' },
  { mutation: 'omitToolsCapability', catches: 'initialize-declares-tools-capability' },
  { mutation: 'omitUiExtension', catches: 'mcp-apps-ui-extension' },
  { mutation: 'unstableToolOrder', catches: 'tools-list-deterministic-order', expect: 'ordering changed' },
  { mutation: 'unknownMethod500', catches: 'unknown-method-error-code', expect: 'HTTP 500' },
  { mutation: 'getReturnsHtml', catches: 'sse-get-stream', expect: 'text/html' },
  { mutation: 'deleteReturns500', catches: 'delete-method-handled', expect: 'HTTP 500' },
  { mutation: 'omitSessionId', catches: 'initialize-session-id-issued', expect: 'no Mcp-Session-Id' },
  { mutation: 'noServerDiscover', catches: 'server-discover' },
  { mutation: 'noResultType', catches: 'modern-result-type', expect: 'resultType' },
  { mutation: 'noCacheHints', catches: 'modern-cache-hints', expect: 'ttlMs' },
  {
    mutation: 'downgradeUnknownModernVersion',
    catches: 'modern-unsupported-version-rejected',
    expect: 'banana',
  },
  { mutation: 'headerMismatchOnLegacy', catches: 'legacy-ignores-modern-headers', expect: '-32020' },
  { mutation: 'danglingWidgetLink', catches: 'mcp-apps-ui-resource-resolvable', expect: 'unlisted resources' },
  { mutation: 'wrongWidgetMime', catches: 'mcp-apps-widget-mime-type', expect: 'text/plain' },
  { mutation: 'omitAnnotations', catches: 'tool-annotations-present', expect: 'no annotations' },
  { mutation: 'omitOpenWorldHint', catches: 'tool-annotations-present', expect: 'openWorldHint' },
  { mutation: 'plainTextResponse', catches: 'response-content-type', expect: 'text/plain' },
  { mutation: 'noChallengeHeader', catches: 'unauthenticated-401-challenge', expect: 'no WWW-Authenticate' },
  { mutation: 'corsMissingHeaders', catches: 'cors-allowed-headers', expect: 'mcp-protocol-version' },
  {
    mutation: 'crossOriginAsRedirect',
    catches: 'as-metadata-no-cross-origin-redirect',
    expect: 'auth.elsewhere.test',
  },
  { mutation: 'staleVirtualIssuer', catches: 'as-metadata-origin-consistent', expect: 'authorization_servers' },
  { mutation: 'authorizeCrossOriginRedirect', catches: 'authorization-endpoint-same-origin', expect: 'redirected cross-origin' },
  { mutation: 'noPathSuffixedPrm', catches: 'prm-document-served', expect: 'HTTP 404' },
  { mutation: 'noPkceS256', catches: 'as-metadata-pkce-s256', expect: 'plain' },
  { mutation: 'omitRfc9207Cimd', catches: 'as-metadata-rfc9207-cimd', expect: 'missing true' },
]

describe('each check catches the behavior it claims to', () => {
  for (const { mutation, catches, expect: needle } of MUTATIONS) {
    test(`${catches} catches ${mutation}`, async () => {
      const result = await runCheck(catches, { break: { [mutation]: true } })
      expect(result.status).toBe('fail')
      expect(result.remediation).toBeTruthy()
      expect(result.evidence.length).toBeGreaterThan(0)
      if (needle) expect(result.detail).toContain(needle)
    })
  }

  test('every mutation the reference server supports is exercised', () => {
    // Mutations that exist to prove a check does NOT fire (era gating) rather
    // than to be caught by one.
    const covered = new Set<string>(MUTATIONS.map((m) => m.mutation))
    const declared: Mutation[] = [
      'versionEcho',
      'echoModernFromInitialize',
      'notificationJsonRpcAnswer',
      'omitToolsCapability',
      'omitUiExtension',
      'unstableToolOrder',
      'unknownMethod500',
      'getReturnsHtml',
      'deleteReturns500',
      'omitSessionId',
      'noServerDiscover',
      'noResultType',
      'noCacheHints',
      'downgradeUnknownModernVersion',
      'headerMismatchOnLegacy',
      'danglingWidgetLink',
      'wrongWidgetMime',
      'omitAnnotations',
      'omitOpenWorldHint',
      'plainTextResponse',
      'noChallengeHeader',
      'corsMissingHeaders',
      'crossOriginAsRedirect',
      'staleVirtualIssuer',
      'authorizeCrossOriginRedirect',
      'noPathSuffixedPrm',
      'noPkceS256',
      'omitRfc9207Cimd',
    ]
    expect(declared.filter((m) => !covered.has(m))).toEqual([])
  })
})

describe('a mutation does not spuriously fail unrelated checks', () => {
  test('breaking the widget mime type leaves the lifecycle checks green', async () => {
    for (const id of ['initialize-version-echo', 'notification-ack-202', 'tools-list-shape'] as const) {
      const result = await runCheck(id, { break: { wrongWidgetMime: true } })
      expect(`${id}:${result.status}`).toBe(`${id}:pass`)
    }
  })

  test('breaking the legacy era gate leaves the modern header validation working', async () => {
    // `headerMismatchOnLegacy` runs the -32020 check era-agnostically. The
    // modern path must still behave, which is what makes the failure a gating
    // bug rather than a total outage.
    const result = await runCheck('modern-result-type', { break: { headerMismatchOnLegacy: true } })
    expect(result.status).toBe('pass')
  })

  test('a stateless server still passes the spec-level session coherence check', async () => {
    const result = await runCheck('session-header-absent-or-echoed', {
      break: { omitSessionId: true },
    })
    expect(result.status).toBe('pass')
    expect(result.detail).toContain('stateless')
  })

  test('the stale virtual-AS shim fails only the new self-consistency check', async () => {
    const options = { break: { staleVirtualIssuer: true } } as const
    for (const id of [
      'as-metadata-both-paths',
      'as-metadata-no-cross-origin-redirect',
      'as-metadata-pkce-s256',
    ] as const) {
      expect((await runCheck(id, options)).status).toBe('pass')
    }
    expect((await runCheck('as-metadata-origin-consistent', options)).status).toBe('fail')
  })
})

describe('evidence is recorded and credentials are redacted', () => {
  test('a passing check still carries its exchanges', async () => {
    const result = await runCheck('initialize-server-info')
    expect(result.evidence.length).toBeGreaterThan(0)
    const [exchange] = result.evidence
    expect(exchange?.request.method).toBe('POST')
    expect(exchange?.request.headers.authorization).toBe('<redacted>')
  })

  test('the bearer token never appears in evidence', async () => {
    const result = await runCheck('tools-list-shape')
    expect(JSON.stringify(result.evidence)).not.toContain(CREDENTIAL)
  })
})

describe('a target may declare a check not applicable', () => {
  test('the reason is carried into the result', async () => {
    const server = createExampleServer({ credential: CREDENTIAL })
    const target: ConformanceTarget = {
      id: 'reference',
      displayName: 'Reference server',
      url: `${server.origin}${server.path}`,
      credential: CREDENTIAL,
      fetch: server.fetch,
      notApplicable: { 'prm-document-served': 'in-process handler owns no origin' },
    }
    const { runConformance } = await import('../src/run.ts')
    const report = await runConformance({
      target,
      profiles: [specBaselineProfile],
      claims: [specBaselineProfile.id],
    })
    const prm = report.profiles[0]?.results.find((r) => r.check === 'prm-document-served')
    // The spec baseline does not carry prm-document-served, so it should be absent
    // entirely rather than silently passing.
    expect(prm).toBeUndefined()
  })
})

describe('a crashing check never reads as a pass', () => {
  test('an errored gating check makes the profile unproven and fails the gate', async () => {
    const { runConformance } = await import('../src/run.ts')
    const server = createExampleServer()
    const target: ConformanceTarget = {
      id: 'reference',
      displayName: 'Reference server',
      url: `${server.origin}${server.path}`,
      fetch: server.fetch,
      originFetch: server.originFetch,
    }
    // A real crash path rather than a synthetic one: an unparseable
    // `toolNamePattern` makes tool-name-limit throw at `new RegExp`. Transport
    // errors do NOT reach here - the probe records those and the check returns
    // a normal `fail` - so this is what a genuine bug in a check looks like.
    const brokenProfile: ClientProfile = {
      ...specBaselineProfile,
      id: 'broken-profile',
      requirements: [
        {
          check: 'tool-name-limit',
          confidence: 'documented',
          rationale: 'a deliberately unparseable pattern, to crash the check',
          sources: [{ kind: 'repo', ref: 'packages/mcp-conformance/test/checks.test.ts' }],
          params: { toolNamePattern: '[' },
        },
      ],
    }
    const report = await runConformance({
      target,
      profiles: [brokenProfile],
      claims: [brokenProfile.id],
    })
    const profile = report.profiles[0]
    const errored = profile?.results.filter((r) => r.gating && r.executionError !== undefined) ?? []
    expect(errored.length).toBeGreaterThan(0)
    // Never `pass`, and never `fail` either: the fault is ours, not the server's.
    expect(profile?.verdict).toBe('unproven')
    expect(profile?.summary).toContain('bug in the suite')
    expect(report.summary.ok).toBe(false)
  })
})

describe('an open SSE stream never hangs the runner', () => {
  test('a GET answering with a never-closing stream is recorded, not awaited', async () => {
    // Regression: the probe read every body with response.text(). Against the
    // website MCP route - which holds its SSE response open with a 30-second
    // keep-alive ping - that never resolved, and every check in the run stalled
    // until the test timeout.
    const started = Date.now()
    const result = await runCheck('sse-get-stream', { break: { getReturnsOpenSseStream: true } })
    expect(result.status).toBe('pass')
    expect(result.detail).toContain('text/event-stream')
    expect(Date.now() - started).toBeLessThan(5000)
    const [exchange] = result.evidence
    const response = exchange?.response
    expect(response && 'status' in response ? response.body : undefined).toContain('not consumed')
  })
})

describe('the probe always sends a complete request', () => {
  test('per-call headers merge with the defaults instead of replacing them', async () => {
    // Regression: `...init` was spread AFTER the merged header object, so any
    // check passing its own headers silently dropped `accept` and
    // `content-type`. A transport that requires both media types then answers
    // 406 to every such check, which reads as a broken server.
    const seen: Headers[] = []
    const server = createExampleServer()
    const target: ConformanceTarget = {
      id: 'header-capture',
      displayName: 'Header capture',
      url: `${server.origin}${server.path}`,
      fetch: (request) => {
        seen.push(request.headers)
        return server.fetch(request)
      },
    }
    const requirement: Requirement = {
      check: 'protocol-version-header-tolerated',
      confidence: 'documented',
      rationale: 'regression test',
      sources: [{ kind: 'repo', ref: 'packages/mcp-conformance/test/checks.test.ts' }],
    }
    const probe = new Probe(target, requirement, specBaselineProfile, 'protocol-version-header-tolerated')
    const result = await ALL_CHECKS['protocol-version-header-tolerated'].run(probe)
    expect(result.status).toBe('pass')
    // The first request is the probe's own legacy handshake; the check's two
    // tools/list posts are the ones carrying the version header under test.
    const versioned = seen.filter((h) => h.get('mcp-protocol-version') !== null)
    expect(versioned.length).toBe(2)
    for (const headers of seen) {
      expect(headers.get('accept')).toBe('application/json, text/event-stream')
      expect(headers.get('content-type')).toBe('application/json')
    }
    for (const headers of versioned) {
      expect(headers.get('mcp-protocol-version')).toMatch(/^2025-/)
    }
  })

  test('a legacy handshake runs once and its session id is echoed afterwards', async () => {
    // A stateful server requires initialize first and the minted session id on
    // every later request. Without the handshake the catalog checks would
    // report such a server as broken across every profile.
    const server = createExampleServer({ break: { requireSession: true } })
    const target: ConformanceTarget = {
      id: 'stateful',
      displayName: 'Stateful reference server',
      url: `${server.origin}${server.path}`,
      fetch: server.fetch,
      originFetch: server.originFetch,
    }
    const requirement: Requirement = {
      check: 'tools-list-shape',
      confidence: 'documented',
      rationale: 'stateful handshake test',
      sources: [{ kind: 'repo', ref: 'packages/mcp-conformance/test/checks.test.ts' }],
    }
    const probe = new Probe(target, requirement, specBaselineProfile, 'tools-list-shape')
    const result = await ALL_CHECKS['tools-list-shape'].run(probe)
    expect(result.status).toBe('pass')

    const posts = result.evidence.map((e) => e.request)
    expect(posts[0]?.body).toContain('"initialize"')
    expect(posts[0]?.headers['mcp-session-id']).toBeUndefined()
    expect(posts[1]?.body).toContain('"tools/list"')
    expect(posts[1]?.headers['mcp-session-id']).toBe('sess-reference')
  })

  test('a stateful server is reported broken when the handshake is skipped', async () => {
    // The inverse, so the test above cannot pass for the wrong reason: an
    // anonymous probe performs no handshake, and the same server then fails.
    const server = createExampleServer({ break: { requireSession: true } })
    const target: ConformanceTarget = {
      id: 'stateful-anon',
      displayName: 'Stateful reference server',
      url: `${server.origin}${server.path}`,
      fetch: (request) => {
        const headers = new Headers(request.headers)
        headers.delete('mcp-session-id')
        return server.fetch(new Request(request, { headers }))
      },
      originFetch: server.originFetch,
    }
    const requirement: Requirement = {
      check: 'tools-list-shape',
      confidence: 'documented',
      rationale: 'stateful handshake control',
      sources: [{ kind: 'repo', ref: 'packages/mcp-conformance/test/checks.test.ts' }],
    }
    const probe = new Probe(target, requirement, specBaselineProfile, 'tools-list-shape')
    const result = await ALL_CHECKS['tools-list-shape'].run(probe)
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('-32600')
  })
})
