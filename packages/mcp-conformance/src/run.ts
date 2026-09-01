/**
 * The runner: point it at an MCP endpoint and a set of client profiles, get
 * back a report saying which clients the endpoint is proven to work with.
 *
 * Two rules shape the whole design.
 *
 * **An unsourced belief never gates.** A requirement whose `confidence` is
 * `inferred` runs and is reported, but its failure cannot fail a run. Only
 * `observed` and `documented` requirements gate. That is what stops a research
 * guess from becoming a build break six months from now, when nobody remembers
 * whether the requirement was ever real.
 *
 * **A skip is always accounted for.** Every skip carries a reason - a target
 * that structurally cannot answer a check declares it in `notApplicable`, and a
 * profile that has no limit to check against says so. There is no silent pass.
 */

import { getCheck } from './checks/index.ts'
import { Probe } from './probe.ts'
import type {
  CheckResult,
  Citation,
  ClientProfile,
  Confidence,
  ConformanceTarget,
  Requirement,
  Unknown,
} from './types.ts'

/** Confidences whose failure is allowed to fail a run. */
const GATING_CONFIDENCE: readonly Confidence[] = ['observed', 'documented']

export function isGating(requirement: Requirement): boolean {
  return !requirement.manual && GATING_CONFIDENCE.includes(requirement.confidence)
}

/** One requirement, evaluated. */
export interface RequirementResult extends CheckResult {
  /** Human title of the check that ran. */
  title: string
  /** What a passing server does. */
  expectation: string
  /** Why this client needs it. */
  rationale: string
  confidence: Confidence
  sources: readonly Citation[]
  /** True when a failure here counts against the verdict. */
  gating: boolean
}

/** A requirement that needs a live third-party client, rendered as a runbook step. */
export interface ManualStep {
  check: string
  title: string
  rationale: string
  sources: readonly Citation[]
}

export type ProfileVerdict = 'pass' | 'fail' | 'unproven'

export interface ProfileReport {
  profileId: string
  displayName: string
  vendor: string
  /** True when the target claims to support this client. Claimed profiles are what CI gates on. */
  claimed: boolean
  verdict: ProfileVerdict
  /** One line explaining the verdict, suitable for a PR body or a customer report. */
  summary: string
  counts: {
    gating: { pass: number; fail: number; skip: number }
    advisory: { pass: number; fail: number; skip: number }
  }
  results: RequirementResult[]
  manual: ManualStep[]
  unknowns: readonly Unknown[]
}

/** Live catalog facts, when the caller supplied an inspector. */
export interface CatalogSummary {
  toolCount: number
  resourceCount: number
  /** False when resources/list itself failed, so an empty list is "unobserved", not "none". */
  resourcesListed: boolean
}

export interface ConformanceReport {
  target: { id: string; displayName: string; url: string }
  startedAt: string
  durationMs: number
  catalog?: CatalogSummary
  profiles: ProfileReport[]
  summary: {
    claimed: number
    proven: number
    failing: number
    unproven: number
    /** True when every claimed profile passed. This is the CI gate. */
    ok: boolean
  }
}

/**
 * Shape of an MCP client that can list a target's catalogue, declared
 * structurally so this package can consume the one your application already
 * has without taking a dependency on it - which in the codebase this was
 * extracted from would have been a cycle.
 *
 * Pass it in and the report carries the catalogue that client sees;
 * omit it and the report simply has no `catalog` section. The runner never
 * writes a second MCP client to fill the gap.
 */
export type EndpointInspector = (
  url: string,
  token: string | null,
) => Promise<
  | { ok: true; tools: unknown[]; resources: unknown[]; resourcesListed: boolean }
  | { ok: false; error: string }
>

export interface RunOptions {
  target: ConformanceTarget
  profiles: readonly ClientProfile[]
  /**
   * Profile ids the target claims to support. Only these gate. Omit to claim
   * every profile passed in.
   */
  claims?: readonly string[]
  /** Optional live catalog inspector; see `EndpointInspector`. */
  inspect?: EndpointInspector
}

async function runRequirement(
  target: ConformanceTarget,
  profile: ClientProfile,
  requirement: Requirement,
): Promise<RequirementResult> {
  const check = getCheck(requirement.check)
  const gating = isGating(requirement)
  const base = {
    title: check.title,
    expectation: check.requirement,
    rationale: requirement.rationale,
    confidence: requirement.confidence,
    sources: requirement.sources,
    gating,
  }

  const notApplicable = target.notApplicable?.[requirement.check]
  if (notApplicable) {
    return {
      ...base,
      check: requirement.check,
      status: 'skip',
      detail: `not applicable to this target: ${notApplicable}`,
      evidence: [],
    }
  }

  const probe = new Probe(target, requirement, profile, requirement.check)
  try {
    const result = await check.run(probe)
    return { ...base, ...result }
  } catch (err) {
    // A check that throws is a bug in the check, not a server failure. It is
    // reported as a skip so it is never counted against the server - but it
    // carries `executionError`, and a gating check that errored blocks a `pass`
    // verdict. Without that flag a crashing check silently became a green
    // profile as long as some other gating check passed, which is exactly the
    // masquerade this catch claims to prevent.
    const message = err instanceof Error ? err.message : String(err)
    return {
      ...base,
      check: requirement.check,
      status: 'skip',
      detail: `check threw: ${message}`,
      evidence: probe.evidence(),
      executionError: message,
    }
  }
}

function summarize(profile: ClientProfile, verdict: ProfileVerdict, results: RequirementResult[]): string {
  const failures = results.filter((r) => r.status === 'fail')
  if (verdict === 'pass') {
    const gatingCount = results.filter((r) => r.gating && r.status === 'pass').length
    const advisory = failures.length
    return advisory === 0
      ? `${gatingCount} cited requirements pass.`
      : `${gatingCount} cited requirements pass; ${advisory} inferred requirement(s) fail and do not gate.`
  }
  if (verdict === 'fail') {
    const gatingFailures = failures.filter((r) => r.gating)
    return `${gatingFailures.length} cited requirement(s) fail: ${gatingFailures.map((r) => r.check).join(', ')}.`
  }
  const errored = results.filter((r) => r.gating && r.executionError !== undefined)
  if (errored.length > 0) {
    return `${errored.length} cited requirement(s) could not be evaluated because the check itself failed: ${errored
      .map((r) => r.check)
      .join(', ')}. This is a bug in the suite, not a verdict on the server.`
  }
  const skipped = results.filter((r) => r.status === 'skip').length
  return profile.requirements.some((r) => isGating(r))
    ? `No cited requirement could be evaluated (${skipped} skipped) - compatibility is unproven, not disproven.`
    : 'This profile carries no cited requirements yet; every assertion about it is inferred or manual.'
}

async function runProfile(
  target: ConformanceTarget,
  profile: ClientProfile,
  claimed: boolean,
): Promise<ProfileReport> {
  const results: RequirementResult[] = []
  const manual: ManualStep[] = []

  for (const requirement of profile.requirements) {
    if (requirement.manual) {
      const check = getCheck(requirement.check)
      manual.push({
        check: requirement.check,
        title: check.title,
        rationale: requirement.rationale,
        sources: requirement.sources,
      })
      continue
    }
    results.push(await runRequirement(target, profile, requirement))
  }

  const counts = {
    gating: { pass: 0, fail: 0, skip: 0 },
    advisory: { pass: 0, fail: 0, skip: 0 },
  }
  for (const result of results) {
    counts[result.gating ? 'gating' : 'advisory'][result.status] += 1
  }

  // A gating check that crashed leaves the profile genuinely unknown. It must
  // not fail the server (the fault is ours) and must not pass it either.
  const gatingErrors = results.filter((r) => r.gating && r.executionError !== undefined)
  const verdict: ProfileVerdict =
    counts.gating.fail > 0
      ? 'fail'
      : gatingErrors.length > 0
        ? 'unproven'
        : counts.gating.pass > 0
          ? 'pass'
          : 'unproven'

  return {
    profileId: profile.id,
    displayName: profile.displayName,
    vendor: profile.vendor,
    claimed,
    verdict,
    summary: summarize(profile, verdict, results),
    counts,
    results,
    manual,
    unknowns: profile.unknowns,
  }
}

/**
 * Run every profile against one endpoint.
 *
 * Profiles run sequentially. Concurrency would halve the wall clock against a
 * live endpoint, and it is deliberately not used: several checks assert on
 * ordering and on session state across two calls, and interleaved traffic from
 * another profile would make those verdicts depend on scheduling.
 */
export async function runConformance(options: RunOptions): Promise<ConformanceReport> {
  const { target, profiles, inspect } = options
  const claims = new Set(options.claims ?? profiles.map((p) => p.id))
  const startedAt = new Date()
  const start = Date.now()

  let catalog: CatalogSummary | undefined
  if (inspect) {
    const inspected = await inspect(target.url, target.credential ?? null)
    if (inspected.ok) {
      catalog = {
        toolCount: inspected.tools.length,
        resourceCount: inspected.resources.length,
        resourcesListed: inspected.resourcesListed,
      }
    }
  }

  const reports: ProfileReport[] = []
  for (const profile of profiles) {
    reports.push(await runProfile(target, profile, claims.has(profile.id)))
  }

  const claimedReports = reports.filter((r) => r.claimed)
  return {
    target: { id: target.id, displayName: target.displayName, url: target.url },
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - start,
    ...(catalog ? { catalog } : {}),
    profiles: reports,
    summary: {
      claimed: claimedReports.length,
      proven: reports.filter((r) => r.verdict === 'pass').length,
      failing: reports.filter((r) => r.verdict === 'fail').length,
      unproven: reports.filter((r) => r.verdict === 'unproven').length,
      // A claimed profile fails the gate when it failed OR when a gating check
      // crashed: a suite that cannot evaluate a requirement has not proven it,
      // and leaving CI green on a broken check is how the whole thing rots.
      ok: claimedReports.every(
        (r) => r.verdict !== 'fail' && !r.results.some((x) => x.gating && x.executionError !== undefined),
      ),
    },
  }
}
