/**
 * Driving an MCP surface with the official MCP Inspector CLI, under Bun.
 *
 * The pin, the install location, the argv and the output parsing live in
 * `mcp-conformance/inspector`, not here, so a second runner - a vitest suite
 * against a Next route, say - drives the same CLI the same way and the two
 * cannot drift. What stays here is the runtime-specific half: spawning a
 * process and standing up a server, which under Bun is `Bun.spawn` and
 * `Bun.serve`. Port these two functions to run the suite under Node or vitest;
 * everything they call is portable.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  inspectorArgs,
  inspectorBin,
  isolatedInspectorEnv,
  parseInspectorOutput,
  type InspectorOptions,
  type InspectorRun,
} from 'mcp-conformance/inspector'

export {
  INSPECTOR_INSTALL_DIR,
  INSPECTOR_INSTALLED_BIN,
  INSPECTOR_PACKAGE,
  INSPECTOR_VERSION,
  inspectorBin,
  requireInspector,
  strictWarnings,
  type InspectorRun,
} from 'mcp-conformance/inspector'

/** One inspector invocation against `url`. */
export async function inspect(
  url: string,
  method: string,
  options: InspectorOptions & { timeoutMs?: number } = {},
): Promise<InspectorRun> {
  const bin = inspectorBin()
  if (!bin) throw new Error('inspect() called without an MCP Inspector binary')

  const home = mkdtempSync(join(tmpdir(), 'mcp-inspector-home-'))
  const proc = Bun.spawn([bin, ...inspectorArgs(url, method, options)], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...isolatedInspectorEnv(home) },
  })

  const timeout = setTimeout(() => proc.kill(), options.timeoutMs ?? 120_000)
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const code = await proc.exited
  clearTimeout(timeout)

  return parseInspectorOutput(code, stdout, stderr)
}

export interface ServedMcp {
  url: string
  stop(): void
}

/**
 * Put a fetch handler on a loopback port and hand back its `/mcp` URL.
 *
 * The inspector speaks real HTTP, so every surface under test has to be a real
 * server: an in-process handler, the way the conformance registry drives them,
 * would skip the transport layer that is half of what the client exercises.
 */
export function serveMcp(handler: (request: Request) => Response | Promise<Response>): ServedMcp {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: handler })
  return {
    url: `http://127.0.0.1:${server.port}/mcp`,
    stop: () => server.stop(true),
  }
}
