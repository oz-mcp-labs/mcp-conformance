/**
 * The profile registry.
 *
 * This replaces the prose. Compatibility knowledge that would otherwise live in
 * `docs/evidence/grok-connector.md` and `docs/dual-era-policy.md` and in the
 * scar tissue of four debugging sessions is here as typed records with
 * citations and executable checks, so it regression-tests instead of being
 * rediscovered per client.
 *
 * Adding a profile: every requirement needs at least one `Citation` and an
 * honest `confidence`. `observed` beats `documented` beats `inferred`, and
 * `inferred` never gates. If a fact cannot be sourced, it belongs in the
 * profile's `unknowns` with a proposed experiment - not in `requirements` with
 * a hopeful confidence.
 */

import type { ClientProfile } from '../types.ts'
import { claudeCodeProfile, claudeConnectorsProfile } from './anthropic.ts'
import { ideClientsProfile } from './ide-clients.ts'
import {
  chatgptDeepResearchProfile,
  chatgptPluginsProfile,
  openaiResponsesApiProfile,
} from './openai.ts'
import { platformPolicyProfile } from './platform-policy.ts'
import { specBaselineProfile } from './spec-baseline.ts'
import { grokConnectorProfile, xaiApiRemoteMcpProfile } from './xai.ts'

/**
 * Every profile, in the order a report should read: the spec floor first, then
 * the vendor clients by how much evidence backs them, then your own policy last
 * because it is forward-looking rather than a description of a live client.
 */
export const ALL_PROFILES: readonly ClientProfile[] = [
  specBaselineProfile,
  claudeConnectorsProfile,
  claudeCodeProfile,
  chatgptPluginsProfile,
  chatgptDeepResearchProfile,
  openaiResponsesApiProfile,
  grokConnectorProfile,
  xaiApiRemoteMcpProfile,
  ideClientsProfile,
  platformPolicyProfile,
]

export type ProfileId = (typeof ALL_PROFILES)[number]['id']

const BY_ID = new Map(ALL_PROFILES.map((profile) => [profile.id, profile]))

export function getProfile(id: string): ClientProfile | undefined {
  return BY_ID.get(id)
}

/** Resolve a list of profile ids, throwing on an unknown one rather than silently running fewer. */
export function resolveProfiles(ids: readonly string[]): ClientProfile[] {
  return ids.map((id) => {
    const profile = BY_ID.get(id)
    if (!profile) {
      throw new Error(`unknown profile "${id}"; known: ${[...BY_ID.keys()].join(', ')}`)
    }
    return profile
  })
}

export {
  chatgptDeepResearchProfile,
  chatgptPluginsProfile,
  claudeCodeProfile,
  claudeConnectorsProfile,
  grokConnectorProfile,
  ideClientsProfile,
  openaiResponsesApiProfile,
  platformPolicyProfile,
  specBaselineProfile,
  xaiApiRemoteMcpProfile,
}
