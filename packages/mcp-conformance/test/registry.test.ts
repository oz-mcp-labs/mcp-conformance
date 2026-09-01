/**
 * Registry integrity.
 *
 * The registry's whole value rests on one promise: every gating assertion
 * carries a citation, and anything unsourced is marked inferred and cannot fail
 * a build. These tests enforce that mechanically, because the promise is only
 * as good as the next person who adds a profile at 11pm.
 */

import { describe, expect, test } from 'bun:test'
import { ALL_CHECKS } from '../src/checks/index.ts'
import { ALL_PROFILES, getProfile, resolveProfiles } from '../src/profiles/index.ts'
import { isGating } from '../src/run.ts'
import type { Citation } from '../src/types.ts'

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function describeCitation(source: Citation): string {
  return `${source.kind}:${source.url ?? source.ref ?? '(empty)'}`
}

describe('profile shape', () => {
  test('profile ids are unique and kebab-case', () => {
    const ids = ALL_PROFILES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => !KEBAB.test(id))).toEqual([])
  })

  test('every profile carries a display name, vendor, and summary', () => {
    for (const profile of ALL_PROFILES) {
      expect(profile.displayName.length).toBeGreaterThan(0)
      expect(profile.vendor.length).toBeGreaterThan(0)
      expect(profile.summary.length).toBeGreaterThan(40)
    }
  })

  test('getProfile and resolveProfiles agree with the list', () => {
    for (const profile of ALL_PROFILES) {
      expect(getProfile(profile.id)).toBe(profile)
    }
    expect(resolveProfiles(ALL_PROFILES.map((p) => p.id))).toEqual([...ALL_PROFILES])
    expect(() => resolveProfiles(['no-such-client'])).toThrow(/unknown profile/)
  })
})

describe('every assertion is sourced', () => {
  test('every requirement names an implemented check', () => {
    for (const profile of ALL_PROFILES) {
      for (const requirement of profile.requirements) {
        expect(`${profile.id}/${requirement.check}`).toBe(
          `${profile.id}/${ALL_CHECKS[requirement.check]?.id ?? 'MISSING'}`,
        )
      }
    }
  })

  test('every requirement carries at least one citation and a rationale', () => {
    for (const profile of ALL_PROFILES) {
      for (const requirement of profile.requirements) {
        const label = `${profile.id}/${requirement.check}`
        expect(`${label}: ${requirement.sources.length} sources`).not.toBe(`${label}: 0 sources`)
        expect(`${label}: ${requirement.rationale.length > 20}`).toBe(`${label}: true`)
      }
    }
  })

  test('a gating requirement is never inferred, and an inferred one never gates', () => {
    for (const profile of ALL_PROFILES) {
      for (const requirement of profile.requirements) {
        const label = `${profile.id}/${requirement.check}`
        if (requirement.confidence === 'inferred') {
          expect(`${label} gates: ${isGating(requirement)}`).toBe(`${label} gates: false`)
        } else if (!requirement.manual) {
          expect(`${label} gates: ${isGating(requirement)}`).toBe(`${label} gates: true`)
        }
      }
    }
  })

  test('a manual requirement never gates', () => {
    for (const profile of ALL_PROFILES) {
      for (const requirement of profile.requirements) {
        if (requirement.manual) {
          expect(isGating(requirement)).toBe(false)
        }
      }
    }
  })
})

describe('citations are checkable', () => {
  const everyCitation: { label: string; source: Citation }[] = []
  for (const profile of ALL_PROFILES) {
    for (const requirement of profile.requirements) {
      for (const source of requirement.sources) {
        everyCitation.push({ label: `${profile.id}/${requirement.check}`, source })
      }
    }
    for (const quirk of profile.quirks) {
      for (const source of quirk.sources) everyCitation.push({ label: `${profile.id}/quirk`, source })
    }
    for (const step of profile.discoverySequence) {
      for (const source of step.sources) {
        everyCitation.push({ label: `${profile.id}/discovery ${step.path}`, source })
      }
    }
  }

  test('a doc or spec citation has an https url and a retrieval date', () => {
    for (const { label, source } of everyCitation) {
      if (source.kind !== 'doc' && source.kind !== 'spec') continue
      expect(`${label} ${describeCitation(source)} url`).toBe(
        `${label} ${describeCitation(source)} url${source.url?.startsWith('https://') ? '' : ' MISSING'}`,
      )
      expect(`${label} retrieved=${source.retrieved}`).toBe(
        `${label} retrieved=${ISO_DATE.test(source.retrieved ?? '') ? source.retrieved : 'MISSING'}`,
      )
    }
  })

  test('an observed or repo citation names where to look', () => {
    for (const { label, source } of everyCitation) {
      if (source.kind !== 'observed' && source.kind !== 'repo') continue
      expect(`${label} ref=${source.ref ? 'present' : 'MISSING'}`).toBe(`${label} ref=present`)
    }
  })

  test('an observed requirement is backed by an observed or repo citation, not only by a vendor doc', () => {
    for (const profile of ALL_PROFILES) {
      for (const requirement of profile.requirements) {
        if (requirement.confidence !== 'observed') continue
        const label = `${profile.id}/${requirement.check}`
        const hasEvidence = requirement.sources.some((s) => s.kind === 'observed' || s.kind === 'repo')
        expect(`${label} has first-hand evidence: ${hasEvidence}`).toBe(`${label} has first-hand evidence: true`)
      }
    }
  })
})

describe('unknowns are actionable', () => {
  test('every unknown proposes an experiment', () => {
    for (const profile of ALL_PROFILES) {
      for (const unknown of profile.unknowns) {
        const label = `${profile.id}: ${unknown.question.slice(0, 50)}`
        expect(`${label} experiment length > 40: ${unknown.experiment.length > 40}`).toBe(
          `${label} experiment length > 40: true`,
        )
      }
    }
  })

  test('a profile with no accepted protocol revisions says why in its unknowns', () => {
    for (const profile of ALL_PROFILES) {
      if (profile.acceptedProtocolRevisions.length > 0) continue
      const mentionsVersion = profile.unknowns.some((u) => /protocolVersion|revision/i.test(u.question))
      expect(`${profile.id} explains its empty revision list: ${mentionsVersion}`).toBe(
        `${profile.id} explains its empty revision list: true`,
      )
    }
  })
})

describe('recorded disagreements state a resolution', () => {
  test('each disagreement has at least two positions and a resolution', () => {
    for (const profile of ALL_PROFILES) {
      for (const disagreement of profile.disagreements ?? []) {
        expect(disagreement.positions.length).toBeGreaterThanOrEqual(2)
        expect(disagreement.resolution.length).toBeGreaterThan(40)
      }
    }
  })
})

describe('coverage', () => {
  test('every implemented check is used by at least one profile', () => {
    const used = new Set<string>()
    for (const profile of ALL_PROFILES) {
      for (const requirement of profile.requirements) used.add(requirement.check)
    }
    const unused = Object.keys(ALL_CHECKS).filter((id) => !used.has(id))
    expect(unused).toEqual([])
  })

  test('each check declares a title and a one-sentence requirement', () => {
    for (const [id, check] of Object.entries(ALL_CHECKS)) {
      expect(`${id} title`).toBe(`${id}${check.title.length > 10 ? '' : ' TOO SHORT'} title`)
      expect(`${id} requirement`).toBe(`${id}${check.requirement.length > 30 ? '' : ' TOO SHORT'} requirement`)
      expect(check.id).toBe(id as typeof check.id)
    }
  })
})
