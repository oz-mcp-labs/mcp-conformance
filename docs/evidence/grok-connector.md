# Grok (xAI) connector support — observed evidence

The source behind the `grok-connector` and `xai-api-remote-mcp` profiles in
`packages/mcp-conformance/src/profiles/xai.ts`. Those two profiles are the
best-evidenced in the registry, because Grok is the one client whose real
connect sequence has been captured on the wire rather than read off a vendor
page.

Hostnames are generalized. What is stated as observed was observed; what is
stated as undocumented is undocumented as of the retrieval dates in the
profile citations.

## 1. What xAI actually requires

Grok reaches an MCP server two ways, and both land on the same wire contract.

**Grok app — custom connector.** `grok.com/connectors` → New Connector → Custom
→ the server URL, then "complete any required authentication". Team admins add
connectors from the cloud console the same way.

**xAI API — remote MCP tool.** A tool entry on the request:

```json
{
  "type": "mcp",
  "server_label": "example",
  "server_url": "https://mcp.example.com/mcp",
  "server_description": "What this server does.",
  "authorization": "<bearer token>",
  "allowed_tools": ["alpha", "zeta"]
}
```

`server_url` and `server_label` are required; `server_description`,
`allowed_tools`, `authorization` and `headers` are optional. `require_approval`
and `connector_id` — both present in OpenAI's Responses API — are **not**
supported by xAI.

| Requirement | Detail |
|---|---|
| Reachability | Public internet, from xAI's infrastructure. `localhost` and private addresses are rejected outright; local servers need a tunnel. |
| Transport | Streamable HTTP or SSE only. A stdio server must be wrapped first. |
| Auth | A token in the `Authorization` header, plus arbitrary extra headers. **The docs describe no OAuth flow, but the connector does run OAuth discovery in practice** — section 5. |
| Tool surface | Discovered from `tools/list`. Tool names are prefixed with `server_label`; `allowed_tools` trims what enters context. |
| Protocol revision | Not documented. This is the risk surface. |

## 2. The two server-side fixes this took

Every hand-rolled MCP surface behind this connector needed the same two things,
and both are now checks in the registry:

1. **Protocol-revision echo.** A surface that answered a fixed revision
   regardless of what `initialize` requested was read by strict clients as
   "server does not speak my version".
2. **Discovery documents answering 200 on the resource origin**, at both the
   root and the path-suffixed form — see section 5 for why the path-suffixed
   one matters.

## 3. Compatibility matrix

Track, per surface you serve, whether it is Grok-ready and what credential it
accepts. The load-bearing column is the credential: a surface that only accepts
short-lived OAuth access tokens works for an hour as a custom connector and then
dies unless refresh is proven (section 4).

## 4. Open gap: short-lived credentials and refresh

A surface that validates only one-hour access tokens has no static credential a
connector can hold. Options, in increasing order of work:

1. Mint a long-lived server key validated by the same lookup.
2. Teach the surface to validate legacy API keys.
3. Verify empirically whether Grok completes a full OAuth 2.1 client flow
   (DCR + PKCE + refresh); if it does, nothing is needed.

**Refresh looks implemented on xAI's side but is unconfirmed against any
specific authorization server.** grok.com's connector service descriptor
exposes a `GetValidAccessToken(scope, scope_id, connector_id)` RPC, an
`InvalidateOAuthToken(connector_id)` RPC, a `refresh_token` flag on the
connector-list request, and a `NEEDS_REAUTH` connector status — a shape that
only makes sense if refresh is the normal path and re-authorization the
fallback. That raises the prior on option (3) without settling it.

The experiment has a concrete pass/fail condition and is carried in the registry
as an `unknown`: connect a URL as a custom connector, wait past the access
token's expiry, issue a tool call, and watch the authorization server for a
`refresh_token` grant at `/oauth/token`.

## 5. Observed: Grok's actual connect sequence, and the 404 that broke it

The first real attempt from `grok.com` on 2026-08-17 failed with "Connection
failed". Production runtime logs show exactly what it did (23:47:05–07Z):

```
GET /mcp                                        401  + WWW-Authenticate -> PRM
GET /.well-known/oauth-protected-resource       200
GET /.well-known/oauth-authorization-server     308  -> other origin (NOT followed)
GET /.well-known/oauth-authorization-server/mcp 404
```

Two facts fall out of that, both contradicting what the docs imply:

1. **Grok runs MCP OAuth discovery.** It reads the `WWW-Authenticate` challenge
   and follows RFC 9728. A static token is not the only path.
2. **It will not follow a cross-origin redirect for authorization-server
   metadata**, and its fallback is the path-suffixed form on the *resource*
   origin.

The root path was a 308 to a different-origin authorization server and the
path-suffixed form did not exist, so discovery dead-ended. Fixed by serving the
authorization server's document with a 200 at both paths on the resource origin.
Mirroring the JSON rather than redirecting keeps the upstream issuer
authoritative while giving such a client a same-origin 200.

This is the single most expensive fact in the registry: three sessions debugged
the server before it was found. The checks
`as-metadata-both-paths` and `as-metadata-no-cross-origin-redirect` exist so it
cannot be rediscovered.

## 6. Resolved 2026-08-18: it connects, and the final blocker was client-side

After the connector's `serverUrl` was corrected from a mistyped path to the real
one, Grok completed the OAuth flow and attached. The protocol-negotiation and
discovery fixes were the necessary server changes; the typo was the remaining
blocker.

Recorded because three sessions debugged the server while the failure was in the
connector's own config: **read the client's connector record first.** Grok
exposes it — including `serverUrl`, `oauthStrategy` and `hasValidOauthTokens` —
in its connectors debug view. A mistyped URL 404s with no `WWW-Authenticate`,
which Grok reports as
`{"isValid":false,"authRequired":false,"oauthStrategy":"OAUTH_STRATEGY_NONE"}`.

Facts recovered from grok.com's connector bundle while diagnosing, none of them
documented by xAI: the OAuth redirect URI is
`https://grok.com/connectors-oauth-exchange-code/`; discovery, DCR and token
exchange run from xAI's backend, so CORS is irrelevant to them; a failed connect
renders the backend's raw error under "Connection failed"; the popup must
complete within 180 seconds; `localhost` and RFC 1918 URLs are rejected
client-side; the strategy enum is UNKNOWN / NONE / DCR / CIMD / BYO, and CIMD
currently degrades to the manual "bring your own client" form.

## 7. Four spec-level hazards for a resource-origin client

An audit of the working flow found four remaining hazards for a client that
treats the resource origin as its authorization server — the MCP 2025-03-26
model, which matches Grok's observed behavior:

1. **Issuer mismatch (RFC 8414 §3.3).** Metadata mirrored at the resource origin
   that names a different origin as `issuer` must be rejected by a conforming
   client. Rebase the document onto the serving origin, with same-origin
   endpoints; reverse-proxy `authorize` so consent HTML and SSO cookies stay
   same-origin.
2. **Scope-list disagreement.** A protected-resource document advertising scopes
   the authorization-server document does not list leaves a client that
   intersects the two with nothing. Carry the union in both.
3. **Secret-bearing DCR with no secret.** Registration that echoes
   `client_secret_basic` / `client_secret_post` without issuing a
   `client_secret` leaves a client that registered as confidential with no
   credential. Issue one, or downgrade the method to `none`.
4. **Token endpoint intolerance.** JSON bodies must not 500, and a
   `client_secret_basic` client that puts `client_id` only in the
   `Authorization: Basic` header must not be rejected for a missing `client_id`.
