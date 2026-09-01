/**
 * Install the pinned MCP Inspector CLI and run the suites that drive it.
 *
 * `bun run test:inspector`, and the same command in CI - one entry point so the
 * pinned version, the install location, and the required flag cannot drift
 * between a developer's machine and the `mcp-inspector` job.
 *
 * The CLI is NOT a workspace dependency on purpose: it pulls ~117 MB (it ships
 * the web UI alongside the CLI), which every `bun install` would otherwise pay
 * for to serve one job. It lands in `node_modules/.cache/mcp-inspector`
 * instead, which git already ignores and CI can cache on the pin file's hash.
 *
 * Adding a second runner: if part of your MCP surface is a separate
 * implementation under a different test runner - a Next route under vitest,
 * say - spawn it here too rather than leaving it ungated. Skipping it would
 * keep this command green for a regression confined to the copy that actually
 * serves production.
 */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ensureInspector } from './lib/inspector-install.ts'

const packageDir = join(import.meta.dir, '..')
const bin = await ensureInspector()

const env = {
  ...process.env,
  MCP_INSPECTOR_BIN: bin,
  // A missing binary is a failure here, never a skip: this command exists to
  // run these suites.
  MCP_INSPECTOR_REQUIRED: '1',
}

const files = ['test/inspector.test.ts']
const run = spawnSync('bun', ['test', ...files, ...Bun.argv.slice(2)], {
  cwd: packageDir,
  stdio: 'inherit',
  env,
})

process.exit(run.status ?? 1)
