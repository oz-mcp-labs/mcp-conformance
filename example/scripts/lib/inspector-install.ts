/**
 * On-demand install of the pinned MCP Inspector CLI.
 *
 * A separate module from `scripts/inspector.ts` so that a second entry point -
 * a live check against a deployed endpoint, say - shares the pin, the install
 * location, and the "is it already there" test rather than restating them.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  INSPECTOR_INSTALL_DIR,
  INSPECTOR_INSTALLED_BIN,
  INSPECTOR_PACKAGE,
  INSPECTOR_VERSION,
} from 'mcp-conformance/inspector'

async function installedVersion(): Promise<string | null> {
  const manifest = Bun.file(
    join(INSPECTOR_INSTALL_DIR, 'node_modules', INSPECTOR_PACKAGE, 'package.json'),
  )
  if (!(await manifest.exists())) return null
  try {
    return (await manifest.json()).version ?? null
  } catch {
    return null
  }
}

/** Install the pinned CLI if it is missing or the wrong version; return its path. */
export async function ensureInspector(): Promise<string> {
  const current = await installedVersion()
  if (current === INSPECTOR_VERSION) return INSPECTOR_INSTALLED_BIN

  console.log(
    current
      ? `MCP Inspector ${current} installed, pinned to ${INSPECTOR_VERSION} - reinstalling.`
      : `Installing ${INSPECTOR_PACKAGE}@${INSPECTOR_VERSION}...`,
  )
  mkdirSync(INSPECTOR_INSTALL_DIR, { recursive: true })
  // npm, not bun: the inspector is a Node CLI with optional platform binaries,
  // and npm is what its own install instructions are tested against.
  const result = spawnSync(
    'npm',
    [
      'install',
      '--no-save',
      '--no-audit',
      '--no-fund',
      '--prefix',
      INSPECTOR_INSTALL_DIR,
      `${INSPECTOR_PACKAGE}@${INSPECTOR_VERSION}`,
    ],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) {
    throw new Error(`installing ${INSPECTOR_PACKAGE}@${INSPECTOR_VERSION} failed with ${result.status}`)
  }
  return INSPECTOR_INSTALLED_BIN
}
