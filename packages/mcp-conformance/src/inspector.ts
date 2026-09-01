/**
 * Locating and driving the official MCP Inspector CLI.
 *
 * The registry in this package answers "does this endpoint meet what each
 * client requires", using our own probe. The Inspector answers a different
 * question - "can the reference client actually use it" - and every suite that
 * asks it needs the same pin, the same install location, and the same reading
 * of its output. Two suites under two runners (Bun and vitest, say) drifting on
 * any of the three is how one of them silently stops testing anything.
 *
 * Only the portable half lives here: constants, argv construction, and output
 * parsing, on node:fs/path so it runs under both Bun and Node. Spawning a
 * process and standing up a server are runtime-specific and stay with each
 * caller.
 */

import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Pinned so a CLI release cannot change the meaning of a green run. */
export const INSPECTOR_PACKAGE = '@modelcontextprotocol/inspector'
export const INSPECTOR_VERSION = '2.4.0'

/**
 * Where the on-demand install lands: the repo root's node_modules/.cache, which
 * git already ignores and CI can cache. The CLI is deliberately not a workspace
 * dependency - it pulls ~117 MB that every `bun install` would otherwise pay
 * for to serve one job.
 *
 * The `../../../` is three levels up from `packages/mcp-conformance/src`. Move
 * this file and that has to move with it.
 */
export const INSPECTOR_INSTALL_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../node_modules/.cache/mcp-inspector',
)

export const INSPECTOR_INSTALLED_BIN = join(INSPECTOR_INSTALL_DIR, 'node_modules/.bin/mcp-inspector')

/**
 * Resolve the CLI: an explicit `MCP_INSPECTOR_BIN` first (what the runner
 * script and CI set), then the on-demand install location.
 */
export function inspectorBin(): string | null {
  const explicit = process.env.MCP_INSPECTOR_BIN?.trim()
  if (explicit) return explicit
  if (!existsSync(INSPECTOR_INSTALLED_BIN)) return null
  return statSync(INSPECTOR_INSTALLED_BIN).size > 0 ? INSPECTOR_INSTALLED_BIN : null
}

/**
 * The CLI, or null with the reason it is missing. Throws instead of returning
 * null when MCP_INSPECTOR_REQUIRED=1, so a CI job that lost its install fails
 * rather than skipping its whole reason for existing.
 */
export function requireInspector(): { bin: string | null; skipReason: string } {
  const bin = inspectorBin()
  if (bin) return { bin, skipReason: '' }
  const reason = `MCP Inspector CLI not found. Run \`bun run test:inspector\` (installs ${INSPECTOR_PACKAGE}@${INSPECTOR_VERSION}), or set MCP_INSPECTOR_BIN.`
  if (process.env.MCP_INSPECTOR_REQUIRED === '1') throw new Error(reason)
  return { bin: null, skipReason: reason }
}

export interface InspectorOptions {
  /** Sent as `Authorization: Bearer <token>` when set. */
  token?: string
  /** Extra CLI flags, e.g. `['--strict']`. */
  flags?: string[]
}

/** The argv for one invocation, minus the binary itself. */
export function inspectorArgs(url: string, method: string, options: InspectorOptions = {}): string[] {
  return [
    '--cli',
    url,
    '--transport',
    'http',
    '--format',
    'json',
    '--connect-timeout',
    '20000',
    '--method',
    method,
    ...(options.token ? ['--header', `Authorization: Bearer ${options.token}`] : []),
    ...(options.flags ?? []),
  ]
}

export interface InspectorRun {
  code: number
  stdout: string
  stderr: string
  /** Parsed `--format json` payload: `{ result }` on success, `{ error }` on failure. */
  json: { result?: Record<string, unknown>; error?: { code?: string; message?: string } } | null
}

/** Parse one invocation's output: the last JSON line on either stream. */
export function parseInspectorOutput(code: number, stdout: string, stderr: string): InspectorRun {
  const payload = (stdout.trim() || stderr.trim()).split('\n').at(-1) ?? ''
  let json: InspectorRun['json'] = null
  try {
    json = payload.startsWith('{') ? JSON.parse(payload) : null
  } catch {
    json = null
  }
  return { code, stdout, stderr, json }
}

/** Every `Warning:` block the `--strict` schema lint emitted, one entry each. */
export function strictWarnings(run: InspectorRun): string[] {
  return run.stderr
    .split(/\n(?=Warning: )/)
    .map((block) => block.trim())
    .filter((block) => block.startsWith('Warning: '))
}

/**
 * A scratch HOME for one run. The CLI otherwise reads and writes
 * `~/.mcp-inspector`, so a test would depend on - and mutate - the developer's
 * own server catalog and stored OAuth tokens.
 */
export function isolatedInspectorEnv(home: string): Record<string, string> {
  return {
    HOME: home,
    MCP_CATALOG_PATH: join(home, 'mcp.json'),
    MCP_CLIENT_CONFIG_PATH: join(home, 'client.json'),
  }
}
