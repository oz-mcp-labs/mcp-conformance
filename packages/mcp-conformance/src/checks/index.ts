/**
 * The check registry: every executable requirement, indexed by id.
 *
 * A profile requirement names a `CheckId`; the runner looks it up here. The
 * union in `types.ts` and this map are kept exhaustive against each other by
 * `ALL_CHECKS` being typed as a total record, so adding a `CheckId` without an
 * implementation is a type error rather than a silent skip at runtime.
 */

import type { Check, CheckId } from '../types.ts'
import {
  deepResearchSearchFetchContract,
  mcpAppsUiExtension,
  mcpAppsUiResourceResolvable,
  mcpAppsWidgetMimeType,
  resourcesListShape,
  toolAnnotationsPresent,
  toolCountLimit,
  toolDescriptionLimit,
  toolNameLimit,
  toolsListDeterministicOrder,
  toolsListShape,
} from './catalog.ts'
import {
  asMetadataBothPaths,
  asMetadataNoCrossOriginRedirect,
  asMetadataPkceS256,
  prmDocumentServed,
  unauthenticated401Challenge,
} from './auth.ts'
import { corsAllowedHeaders, corsExposedHeaders, corsPreflight } from './cors.ts'
import {
  initializeDeclaresToolsCapability,
  initializeNeverEchoesModernRevision,
  initializeServerInfo,
  initializeUnsupportedVersionFallback,
  initializeVersionEcho,
  notificationAck202,
  protocolVersionHeaderTolerated,
  unknownMethodErrorCode,
} from './lifecycle.ts'
import {
  legacyIgnoresModernHeaders,
  modernCacheHints,
  modernResultType,
  modernUnsupportedVersionRejected,
  serverDiscover,
} from './modern.ts'
import {
  deleteMethodHandled,
  responseContentType,
  sessionHeaderAbsentOrEchoed,
  sseGetStream,
} from './transport.ts'

export const ALL_CHECKS: Record<CheckId, Check> = {
  'initialize-version-echo': initializeVersionEcho,
  'initialize-unsupported-version-fallback': initializeUnsupportedVersionFallback,
  'initialize-server-info': initializeServerInfo,
  'initialize-declares-tools-capability': initializeDeclaresToolsCapability,
  'initialize-never-echoes-modern-revision': initializeNeverEchoesModernRevision,
  'notification-ack-202': notificationAck202,
  'tools-list-shape': toolsListShape,
  'tools-list-deterministic-order': toolsListDeterministicOrder,
  'resources-list-shape': resourcesListShape,
  'protocol-version-header-tolerated': protocolVersionHeaderTolerated,
  'unknown-method-error-code': unknownMethodErrorCode,
  'server-discover': serverDiscover,
  'modern-result-type': modernResultType,
  'modern-cache-hints': modernCacheHints,
  'modern-unsupported-version-rejected': modernUnsupportedVersionRejected,
  'legacy-ignores-modern-headers': legacyIgnoresModernHeaders,
  'response-content-type': responseContentType,
  'sse-get-stream': sseGetStream,
  'delete-method-handled': deleteMethodHandled,
  'session-header-absent-or-echoed': sessionHeaderAbsentOrEchoed,
  'unauthenticated-401-challenge': unauthenticated401Challenge,
  'prm-document-served': prmDocumentServed,
  'as-metadata-both-paths': asMetadataBothPaths,
  'as-metadata-no-cross-origin-redirect': asMetadataNoCrossOriginRedirect,
  'as-metadata-pkce-s256': asMetadataPkceS256,
  'cors-preflight': corsPreflight,
  'cors-allowed-headers': corsAllowedHeaders,
  'cors-exposed-headers': corsExposedHeaders,
  'tool-name-limit': toolNameLimit,
  'tool-description-limit': toolDescriptionLimit,
  'tool-count-limit': toolCountLimit,
  'mcp-apps-ui-extension': mcpAppsUiExtension,
  'tool-annotations-present': toolAnnotationsPresent,
  'mcp-apps-ui-resource-resolvable': mcpAppsUiResourceResolvable,
  'mcp-apps-widget-mime-type': mcpAppsWidgetMimeType,
  'deep-research-search-fetch-contract': deepResearchSearchFetchContract,
}

export function getCheck(id: CheckId): Check {
  return ALL_CHECKS[id]
}

export {
  asMetadataBothPaths,
  asMetadataNoCrossOriginRedirect,
  asMetadataPkceS256,
  deepResearchSearchFetchContract,
  mcpAppsWidgetMimeType,
  toolAnnotationsPresent,
  corsAllowedHeaders,
  corsExposedHeaders,
  corsPreflight,
  deleteMethodHandled,
  initializeDeclaresToolsCapability,
  initializeNeverEchoesModernRevision,
  initializeServerInfo,
  initializeUnsupportedVersionFallback,
  initializeVersionEcho,
  legacyIgnoresModernHeaders,
  mcpAppsUiExtension,
  mcpAppsUiResourceResolvable,
  modernCacheHints,
  modernResultType,
  modernUnsupportedVersionRejected,
  notificationAck202,
  prmDocumentServed,
  protocolVersionHeaderTolerated,
  resourcesListShape,
  responseContentType,
  serverDiscover,
  sessionHeaderAbsentOrEchoed,
  sseGetStream,
  toolCountLimit,
  toolDescriptionLimit,
  toolNameLimit,
  toolsListDeterministicOrder,
  toolsListShape,
  unauthenticated401Challenge,
  unknownMethodErrorCode,
}

/**
 * The checks that mean something without a credential: the auth challenge
 * itself, the discovery documents, and the CORS preflight.
 *
 * Lives here rather than in a caller because it is a property of the checks,
 * not of any one runner. Two callers need it - the `check_mcp_conformance`
 * tool, which is pointed at endpoints the control plane holds no token for,
 * and the live-endpoint CI script - and a second copy would rot.
 *
 * Running the rest anonymously would collect a wall of 401s and report every
 * client as failing, which says "your server is broken" when the truth is "you
 * did not give me a token".
 */
export const ANONYMOUS_CAPABLE_CHECKS: readonly CheckId[] = [
  'unauthenticated-401-challenge',
  'prm-document-served',
  'as-metadata-both-paths',
  'as-metadata-no-cross-origin-redirect',
  'as-metadata-pkce-s256',
  'cors-preflight',
  'cors-allowed-headers',
]

/** Every check that is NOT anonymous-capable, mapped to `reason`. */
export function anonymousNotApplicable(reason: string): Partial<Record<CheckId, string>> {
  return Object.fromEntries(
    (Object.keys(ALL_CHECKS) as CheckId[])
      .filter((id) => !ANONYMOUS_CAPABLE_CHECKS.includes(id))
      .map((id) => [id, reason]),
  )
}
