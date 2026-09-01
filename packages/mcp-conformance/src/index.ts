/**
 * mcp-conformance
 *
 * A machine-checkable registry of how each real MCP client actually behaves,
 * plus a runner that proves an endpoint works against them.
 *
 * The problem it solves: one endpoint has to work in Claude, ChatGPT, Grok,
 * and arbitrary SDK clients, and what each of them actually requires lives as
 * prose and as scar tissue from debugging sessions. Prose does not
 * regress-test. Here it is a typed profile per client, an executable check per
 * requirement, and a report a customer can read.
 *
 * Usage - offline, against an in-process handler:
 *
 * ```ts
 * import { runConformance, ALL_PROFILES, renderTextReport } from 'mcp-conformance'
 *
 * const report = await runConformance({
 *   target: {
 *     id: 'my-mcp-server',
 *     displayName: 'My MCP server',
 *     url: 'https://mcp.example.com/mcp',
 *     fetch: (request) => myHandler(request),
 *     notApplicable: { 'prm-document-served': 'public server serves no OAuth metadata' },
 *   },
 *   profiles: ALL_PROFILES,
 *   claims: ['mcp-spec-baseline', 'example-platform-policy'],
 * })
 * console.log(renderTextReport(report))
 * ```
 *
 * Usage - live, against a deployed endpoint, letting your own MCP client
 * supply the catalog:
 *
 * ```ts
 * const report = await runConformance({ target, profiles, inspect: myMcpClient })
 * ```
 */

export * from './types.ts'
export { ALL_CHECKS, ANONYMOUS_CAPABLE_CHECKS, anonymousNotApplicable, getCheck } from './checks/index.ts'
export { ALL_PROFILES, getProfile, resolveProfiles } from './profiles/index.ts'
export type { ProfileId } from './profiles/index.ts'
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
} from './profiles/index.ts'
export { Probe, headerList, jsonRpcErrorCode, jsonRpcResult } from './probe.ts'
export { createExampleServer } from './example-server.ts'
export type { ExampleServerOptions, Mutation } from './example-server.ts'
export { isGating, runConformance } from './run.ts'
export type {
  CatalogSummary,
  ConformanceReport,
  EndpointInspector,
  ManualStep,
  ProfileReport,
  ProfileVerdict,
  RequirementResult,
  RunOptions,
} from './run.ts'
export {
  formatCitation,
  renderManualRunbook,
  renderMarkdownMatrix,
  renderMarkdownReport,
  renderTextReport,
} from './report.ts'
export type { TextReportOptions } from './report.ts'
