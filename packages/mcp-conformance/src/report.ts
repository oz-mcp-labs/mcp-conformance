/**
 * Renderers for a conformance report.
 *
 * Three audiences, three renderers:
 * - `renderTextReport` - a CI log and a terminal. Dense, greppable.
 * - `renderMarkdownReport` - a PR body or a customer-facing summary.
 * - `renderManualRunbook` - the checks that need a human at a real client, so
 *   they are visible as work rather than silently absent from CI.
 */

import type { ConformanceReport, ManualStep, ProfileReport, RequirementResult } from './run.ts'
import type { Citation } from './types.ts'

const VERDICT_LABEL = { pass: 'PROVEN', fail: 'FAILING', unproven: 'UNPROVEN' } as const
const STATUS_LABEL = { pass: 'pass', fail: 'FAIL', skip: 'skip' } as const

/** Render one citation compactly: the reader must be able to go check it. */
export function formatCitation(source: Citation): string {
  switch (source.kind) {
    case 'doc':
    case 'spec':
      return `${source.url ?? '(no url)'}${source.retrieved ? ` (retrieved ${source.retrieved})` : ''}`
    case 'observed':
      return `observed: ${source.ref ?? '(no ref)'}${source.retrieved ? ` (${source.retrieved})` : ''}`
    case 'repo':
      return `repo: ${source.ref ?? '(no ref)'}`
  }
}

function formatResult(result: RequirementResult): string[] {
  const lines = [
    `    [${STATUS_LABEL[result.status]}] ${result.check} (${result.confidence}${result.gating ? ', gating' : ', advisory'})`,
    `        ${result.detail}`,
  ]
  if (result.status === 'fail' && result.remediation) {
    lines.push(`        fix: ${result.remediation}`)
  }
  if (result.status === 'fail') {
    for (const source of result.sources) lines.push(`        source: ${formatCitation(source)}`)
  }
  return lines
}

function formatProfile(profile: ProfileReport, verbose: boolean): string[] {
  const claim = profile.claimed ? 'claimed' : 'not claimed'
  const lines = [
    `  ${VERDICT_LABEL[profile.verdict]}  ${profile.displayName} (${profile.profileId}, ${claim})`,
    `    ${profile.summary}`,
    `    gating ${profile.counts.gating.pass} pass / ${profile.counts.gating.fail} fail / ${profile.counts.gating.skip} skip` +
      `  |  advisory ${profile.counts.advisory.pass} pass / ${profile.counts.advisory.fail} fail / ${profile.counts.advisory.skip} skip`,
  ]
  for (const result of profile.results) {
    if (!verbose && result.status === 'pass') continue
    lines.push(...formatResult(result))
  }
  if (profile.manual.length > 0) {
    lines.push(`    manual (never gates): ${profile.manual.map((m) => m.check).join(', ')}`)
  }
  return lines
}

export interface TextReportOptions {
  /** Include passing requirements. Off by default so CI logs stay readable. */
  verbose?: boolean
}

export function renderTextReport(report: ConformanceReport, options: TextReportOptions = {}): string {
  const lines = [
    `MCP conformance: ${report.target.displayName} (${report.target.url})`,
    `  ${report.summary.proven} proven / ${report.summary.failing} failing / ${report.summary.unproven} unproven` +
      `  across ${report.profiles.length} profiles, ${report.summary.claimed} claimed` +
      `  [${report.durationMs}ms]`,
  ]
  if (report.catalog) {
    lines.push(
      `  catalog: ${report.catalog.toolCount} tools, ` +
        (report.catalog.resourcesListed ? `${report.catalog.resourceCount} resources` : 'resources unobserved'),
    )
  }
  lines.push('')
  for (const profile of report.profiles) {
    lines.push(...formatProfile(profile, options.verbose === true))
    lines.push('')
  }
  lines.push(report.summary.ok ? 'RESULT: every claimed client passes.' : 'RESULT: a claimed client is failing.')
  return lines.join('\n')
}

/** Group manual steps across profiles into one runbook. */
export function renderManualRunbook(report: ConformanceReport): string {
  const steps: { profile: string; step: ManualStep }[] = []
  for (const profile of report.profiles) {
    for (const step of profile.manual) steps.push({ profile: profile.displayName, step })
  }
  if (steps.length === 0) return 'No manual steps: every requirement in these profiles is machine-checkable.'
  const lines = [
    `Manual verification for ${report.target.displayName} (${report.target.url})`,
    'These need a real third-party client and are never run in CI.',
    '',
  ]
  for (const [index, { profile, step }] of steps.entries()) {
    lines.push(`${index + 1}. [${profile}] ${step.title}`)
    lines.push(`   why: ${step.rationale}`)
    for (const source of step.sources) lines.push(`   source: ${formatCitation(source)}`)
  }
  return lines.join('\n')
}

function markdownRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

export function renderMarkdownReport(report: ConformanceReport): string {
  const lines = [
    `### ${report.target.displayName}`,
    '',
    `\`${report.target.url}\``,
    '',
    markdownRow(['Client', 'Verdict', 'Claimed', 'Detail']),
    markdownRow(['---', '---', '---', '---']),
  ]
  for (const profile of report.profiles) {
    lines.push(
      markdownRow([
        `${profile.displayName} (\`${profile.profileId}\`)`,
        VERDICT_LABEL[profile.verdict],
        profile.claimed ? 'yes' : 'no',
        profile.summary,
      ]),
    )
  }

  const failures = report.profiles.flatMap((profile) =>
    profile.results
      .filter((r) => r.status === 'fail')
      .map((r) => ({ profile: profile.displayName, result: r })),
  )
  if (failures.length > 0) {
    lines.push('', '#### Failures', '')
    // One failing check often fails for several profiles at once; group by check
    // so the reader sees one problem rather than five copies of it.
    const byCheck = new Map<string, { profiles: string[]; result: RequirementResult }>()
    for (const { profile, result } of failures) {
      const entry = byCheck.get(result.check)
      if (entry) entry.profiles.push(profile)
      else byCheck.set(result.check, { profiles: [profile], result })
    }
    for (const [check, { profiles, result }] of byCheck) {
      lines.push(
        `- **\`${check}\`** (${result.gating ? 'gating' : 'advisory'}) - affects ${profiles.join(', ')}`,
        `  - ${result.detail}`,
        ...(result.remediation ? [`  - Fix: ${result.remediation}`] : []),
        ...result.sources.map((s) => `  - Source: ${formatCitation(s)}`),
      )
    }
  }

  const unknowns = report.profiles.flatMap((p) => p.unknowns.map((u) => ({ profile: p.displayName, u })))
  if (unknowns.length > 0) {
    lines.push('', '#### Open unknowns', '')
    for (const { profile, u } of unknowns) {
      lines.push(`- **${profile}**: ${u.question}`, `  - Experiment: ${u.experiment}`)
    }
  }
  return lines.join('\n')
}

/** Render several target reports as one document. */
export function renderMarkdownMatrix(reports: readonly ConformanceReport[]): string {
  if (reports.length === 0) return 'No surfaces were run.'
  const profileIds = reports[0]?.profiles.map((p) => p.profileId) ?? []
  const header = ['Surface', ...profileIds]
  const lines = [markdownRow(header), markdownRow(header.map(() => '---'))]
  for (const report of reports) {
    const cells = [`${report.target.displayName}`]
    for (const id of profileIds) {
      const profile = report.profiles.find((p) => p.profileId === id)
      cells.push(profile ? VERDICT_LABEL[profile.verdict] : 'n/a')
    }
    lines.push(markdownRow(cells))
  }
  return lines.join('\n')
}
