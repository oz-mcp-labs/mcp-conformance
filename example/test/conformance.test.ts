/**
 * Cross-client conformance for the example server.
 *
 * This is the template's first gate. It runs the whole profile registry - the
 * spec floor, Anthropic, OpenAI, xAI, IDE clients, and the house policy -
 * against a target in process, and fails the build when a profile the target
 * *claims* to support stops passing.
 *
 * The three things to change when you point this at your own server:
 *
 * 1. `createServer()` in `src/server.ts` - the handler under test.
 * 2. `CLAIMS` - the profiles you are asserting support for. A profile left out
 *    of this list still runs and still reports; it just cannot fail the build.
 * 3. `KNOWN_GAPS` - the gating failures you have accepted, by profile. The
 *    second test asserts the set is EXACTLY this, so a new failure is red and a
 *    fixed one is also red until you delete the entry. That is deliberate: a
 *    gap list that only ever grows is how a matrix rots.
 *
 * If authenticating your handler reaches a database, mock the authenticator
 * rather than the route - everything downstream (dispatch, catalogue, scopes,
 * CORS, era negotiation) then stays the real code path, and the anonymous 401
 * stays real, which is what the discovery checks hang off:
 *
 * ```ts
 * import { mock } from 'bun:test'
 * mock.module(join(import.meta.dir, '../../src/auth.ts'), () => ({
 *   authenticate: async (r: Request) =>
 *     r.headers.get('authorization') === `Bearer ${CREDENTIAL}` ? { id: 'usr_test' } : null,
 * }))
 * ```
 */

import { describe, expect, test } from 'bun:test'
import {
  ALL_PROFILES,
  renderTextReport,
  runConformance,
  type CheckId,
  type ConformanceReport,
} from 'mcp-conformance'
import { CREDENTIAL, createServer } from '../src/server.ts'

/**
 * Checks this target genuinely cannot answer, mapped to the reason. The reason
 * is printed in the report, so a skip is always accounted for.
 *
 * The example server serves its own `.well-known` documents through
 * `originFetch`, so nothing is waived here. A handler that answers only `/mcp`
 * and leaves discovery to whatever mounts it would waive the four document
 * checks and keep `unauthenticated-401-challenge` gating - the challenge is the
 * handler's, the documents are the mount's.
 */
const NOT_APPLICABLE: Partial<Record<CheckId, string>> = {}

/** The profiles this server asserts support for. These are what CI gates on. */
const CLAIMS = [
  'mcp-spec-baseline',
  'claude-connectors',
  'claude-code',
  'chatgpt-plugins',
  'openai-responses-api',
  'grok-connector',
  'xai-api-remote-mcp',
  'ide-remote-clients',
  'example-platform-policy',
] as const

/**
 * Gating failures that are accepted, by profile.
 *
 * `chatgpt-deep-research` requires a two-tool `search` / `fetch` contract over a
 * document corpus. A server whose tools operate on something else fails it by
 * construction, which is a product decision rather than a bug - so it is
 * recorded here and left out of `CLAIMS`, not hidden.
 */
const KNOWN_GAPS: Record<string, string[]> = {
  'chatgpt-deep-research': ['deep-research-search-fetch-contract'],
}

async function runExampleConformance(): Promise<ConformanceReport> {
  const server = createServer()
  return runConformance({
    target: {
      id: 'example-mcp-server',
      displayName: 'Example MCP server',
      url: `${server.origin}${server.path}`,
      credential: CREDENTIAL,
      fetch: server.fetch,
      originFetch: server.originFetch,
      notApplicable: NOT_APPLICABLE,
    },
    profiles: ALL_PROFILES,
    claims: [...CLAIMS],
  })
}

function gatingFailures(report: ConformanceReport): Record<string, string[]> {
  const actual: Record<string, string[]> = {}
  for (const profile of report.profiles) {
    const failures = profile.results.filter((r) => r.status === 'fail' && r.gating).map((r) => r.check)
    if (failures.length > 0) actual[profile.profileId] = failures.sort()
  }
  return actual
}

describe('example server conformance', () => {
  test('every claimed client profile passes', async () => {
    const report = await runExampleConformance()
    const failing = report.profiles.filter((p) => p.claimed && p.verdict === 'fail')
    if (failing.length > 0) console.error(renderTextReport(report))
    expect(failing.map((p) => `${p.profileId}: ${p.summary}`)).toEqual([])
    expect(report.summary.ok).toBe(true)
  })

  test('the set of known gaps is exactly what is recorded', async () => {
    const report = await runExampleConformance()
    const actual = gatingFailures(report)
    if (JSON.stringify(actual) !== JSON.stringify(KNOWN_GAPS)) console.error(renderTextReport(report))
    expect(actual).toEqual(KNOWN_GAPS)
  })

  test('the unauthenticated OAuth challenge is proven, not waived', async () => {
    // The 401 challenge is what points a connector at the discovery documents.
    // Waiving it would make an entirely broken OAuth chain read as green.
    const report = await runExampleConformance()
    const challenge = report.profiles
      .flatMap((p) => p.results)
      .filter((r) => r.check === 'unauthenticated-401-challenge')
    expect(challenge.length).toBeGreaterThan(0)
    expect(challenge.every((r) => r.status === 'pass')).toBe(true)
  })
})
