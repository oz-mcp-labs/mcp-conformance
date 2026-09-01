/**
 * The seam. **This is the file you replace.**
 *
 * Both gates in this repo - the conformance registry and the MCP Inspector CLI
 * - drive a `(request: Request) => Response` handler and nothing else. Point
 * `createServer` at your own handler and every test in `test/` runs against
 * your server without another edit.
 *
 * What the two exports are for:
 *
 * - `fetch` answers the MCP endpoint itself. The Inspector suite puts it on a
 *   loopback port; the conformance suite calls it in process.
 * - `originFetch` answers same-origin paths that are NOT the endpoint, which in
 *   practice means the two `.well-known` OAuth discovery documents. Every
 *   connector walks those before it has a token, and it is where the expensive
 *   failures live, so the registry checks them separately. If your endpoint and
 *   your discovery documents are served by different code - a Next route and a
 *   worker, say - this is where you join them back together for the test.
 *
 * `CREDENTIAL` is the bearer token the suites present. A real server should
 * read a test-only credential from the environment or mock its authenticator
 * (see the note in `test/conformance.test.ts`); it is inline here because the
 * example server checks it with a string compare and reaches nothing else.
 */

import { createExampleServer } from 'mcp-conformance/example-server'

/** Bearer token the suites present. Replace with however your server is authenticated under test. */
export const CREDENTIAL = 'example_conformance_token'

/** Absolute URL the endpoint is reachable at. Used to derive `.well-known` paths and the expected Origin. */
export const ENDPOINT_URL = 'https://mcp.example.com/mcp'

const endpoint = new URL(ENDPOINT_URL)

/**
 * Replace this call with your own handler:
 *
 * ```ts
 * import { handleMcp } from '../../src/route.ts'
 * export function createServer() {
 *   return { fetch: handleMcp, originFetch: handleWellKnown, origin, path }
 * }
 * ```
 */
export function createServer() {
  return createExampleServer({
    credential: CREDENTIAL,
    origin: endpoint.origin,
    path: endpoint.pathname,
  })
}
