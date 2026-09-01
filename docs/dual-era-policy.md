# MCP dual-era policy (normative)

The house rule that `example-platform-policy` in
`packages/mcp-conformance/src/profiles/platform-policy.ts` makes executable.
Every requirement in that profile cites a section of this file. Change one and
change the other, or the citation stops resolving.

This is a template. Adopt it, edit it, or replace it — but keep the pairing:
a policy nobody can point a failing test at is a review step someone forgets.

## The rule

Every MCP surface built or modified here handles both eras.

**Modern era (primary): `2026-07-28`.** Stateless, single-POST. Protocol
version, client identity and client capabilities arrive in `_meta` on every
request (`io.modelcontextprotocol/protocolVersion`, `.../clientInfo`,
`.../clientCapabilities`); results carry `.../serverInfo` in `_meta`.
`server/discover` is implemented. Every result carries `resultType`.
`tools/list`, `prompts/list`, `resources/list`, `resources/read` and
`resources/templates/list` carry `ttlMs` + `cacheScope`. Modern error codes
apply: `-32602` resource-not-found, `-32020` HeaderMismatch, `-32021`
MissingRequiredClientCapability, `-32022` UnsupportedProtocolVersion.

**Legacy era (fallback): `2025-03-26`, `2025-06-18`, `2025-11-25`.**
`initialize` / `notifications/initialized` lifecycle, version echo,
`mcp-session-id` echo, notifications answered `202` with no body, GET/SSE kept
where a surface already serves it.

**`2024-11-05` stays unsupported everywhere.** That revision's transport is the
HTTP+SSE pair, where responses arrive on a separately opened channel. A handler
that answers on the POST itself and claims `2024-11-05` reports a successful
negotiation and then strands the client.

**Modern-only is forbidden.** Legacy clients cannot fall forward, and a
modern-only server works with almost none of the clients that exist today.

**Legacy-only is a policy violation for new work.** A brand-new surface ships
dual-era from its first commit. An existing legacy-only surface gains the
modern path when it is next touched.

Which client requires what — with a citation and an executable check per
requirement — is `packages/mcp-conformance`. Update the profile there when a
client's behavior changes. This document stays the rule, not the client
inventory.

## Era detection

Detection is **per request**. Keep no session state for it.

The header or `_meta` **value** decides, compared lexicographically on the raw
string: `marker >= "2026-07-28"` is modern. Do not first gate on a `YYYY-MM-DD`
shape. Shape-gating is how one runtime silently downgraded
`MCP-Protocol-Version: banana` to the legacy path while its sibling correctly
rejected it — the same input, two answers, from two copies of one rule.

A modern-era version marker the surface does not support is answered `-32022`
with the supported list. It is never silently downgraded; that is the one
outcome the spec forbids.

`server/discover` and `subscriptions/listen` are modern-only methods, so their
presence is an era signal on its own even with no marker.

### `initialize` cannot reach the modern era, by design

`initialize` with `protocolVersion: "2026-07-28"` answers the newest **legacy**
revision, not the requested one. That follows from the two rules above —
`initialize` is always a legacy request, and the modern revision is not in the
legacy echo set — and it is the legacy spec's own behavior.

It is worth stating anyway, because a spec-conformant client that receives a
revision it did not request either disconnects or pins itself to the answered
revision for the session and never sends a modern marker again. **A hybrid
client that opens with `initialize` therefore cannot reach the modern era.**
Reaching it is `server/discover`, or a modern version marker on any request —
never `initialize`.

## Server checklist

Both paths must pass on every surface.

1. **CORS allow-lists** include `MCP-Protocol-Version`, `Mcp-Method` and
   `Mcp-Name` alongside the legacy headers, and keep `mcp-session-id` until
   legacy retirement. `Access-Control-Allow-Headers` matches literal names, so
   a wildcard does not cover `Authorization` and `Mcp-Param-*` is not expanded:
   enumerate the concrete names, or reflect them from
   `Access-Control-Request-Headers`.
2. **Header/body validation is modern-only.** When `Mcp-Method` / `Mcp-Name` are
   present and the body is parsed, a mismatch is rejected `400` + `-32020`.
   **Gate the check on the detected era.** These headers do not exist in the
   legacy revisions, so a legacy request must ignore them the way it ignores any
   unknown header, and `-32020` is a code no legacy client can interpret.
   Running it era-agnostically makes a modern-aware client that fell back to the
   legacy lifecycle — but kept sending the headers — start eating 400s.
3. **`server/discover`** returns supported versions, capabilities and identity.
   `protocolVersions` lists **every** revision the surface speaks, newest first,
   across both eras. Advertising only `2026-07-28` tells a negotiating client
   that legacy is unavailable and contradicts the `.well-known` documents.
   Newest-first so a client that naively takes the head lands on the modern
   revision.
4. **`resultType: "complete"`** on every result (or `"input_required"` where
   mid-request tool resolution applies), plus `_meta` serverInfo on the modern
   path; `ttlMs` + `cacheScope` on the five list/read methods. Without the cache
   hints a stateless client re-lists every turn, which is the cost the modern
   era exists to remove.
5. **Legacy lifecycle intact:** `initialize` echoes the requested revision when
   supported, notifications get `202` with no body, session-id echo preserved.
6. **MCP Apps:** advertise `extensions: { "io.modelcontextprotocol/ui": {} }` on
   both paths. Gate `_meta.ui` on the caller's declared capabilities **only**
   when modern per-request `_meta` capabilities are actually present; when they
   are absent — which is every legacy client — keep emitting it unconditionally.
   Gating unconditionally makes widgets vanish for every current client.
7. **Deterministic tool ordering** in `tools/list`. A spec SHOULD, and it also
   improves prompt-cache hits.
8. **Tests cover both eras.** Every surface change lands with handshake and
   dispatch tests for a modern request and a legacy request.

Prefer sharing the dual-era plumbing — era detection, discover payloads,
`resultType` and cache stamping, error mapping — through a single protocol
module rather than hand-rolling it per surface. Two copies of one route whose
authorization tables silently drifted apart is the cautionary precedent this
rule exists for.

## Client checklist

Clients you operate must be **era-detecting**: attempt modern, fall back to the
legacy handshake on failure, and cache the detected era per origin. A client
that hard-codes one era is the mirror image of a server that serves one.

## What users inherit must be era-correct

Anything bundled into a user artifact at build time is frozen there, so a stale
template propagates further than a stale server. Runtimes, scaffolds, examples,
agent skills and the `.well-known` documents all fall under this policy.

## Review gate

A PR touching any MCP surface is checked against this document. The mechanical
half of that gate is the `mcp-conformance` job in
`.github/workflows/mcp-conformance.yml`; the `example-platform-policy` profile
is where each item above becomes a test that can go red.

## Background

The modern revision's design goals — stateless single-POST, per-request `_meta`,
cacheable list results — are what make the cache hints and `resultType`
requirements above worth the retrofit rather than ceremony. A surface that
adopts the modern path without them is modern in name only: a stateless client
still re-lists every turn.
