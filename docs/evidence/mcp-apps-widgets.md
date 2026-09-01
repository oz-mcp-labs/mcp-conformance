# MCP Apps widgets — host sandbox compatibility findings

The source behind the MCP Apps requirements in the Anthropic profiles
(`packages/mcp-conformance/src/profiles/anthropic.ts`).

These are **observations of current host behavior, not spec guarantees.**
Re-probe after host updates and move the profile's confidence accordingly. They
were captured against the claude.ai widget sandbox, the highest-value host.

## Findings

**External live iframes are blocked.** The sandbox CSP is effectively
`frame-src 'self' blob: data:` — a widget cannot embed a live external page in a
nested iframe, even when that origin is declared in `frameDomains`.
`srcdoc` / blob / data documents still work, which is why an HTML-preview widget
must fetch page HTML and render it via `srcdoc` rather than framing the live URL.

**Module fetches from CDNs fail inside inline embeds while inline scripts
execute.** `<script type="module" src="https://esm.sh/...">`, and dynamic
`import()` of a CDN URL, does not load inside an inline widget embed; a plain
inline `<script>` block runs fine. Widgets must be fully self-contained — do not
count on CDN module resolution even with the origin declared in
`resourceDomains`.

**One instance per linked tool call; instances are independent and
unaddressable.** Six consecutive tool calls in one turn produced six separate
widget instances, each rendering only from its own payload, with no host
mechanism to update an earlier one. The control case in the same run: the one
tool without `_meta.ui` rendered as a collapsed text row and no iframe. Treat
the transcript as append-only and budget linkage accordingly.

**A stale instance is worse than no instance when its payload is partial.** In
the same run, a tool whose payload carried only the item it had just created
rendered "nothing here yet" directly beneath its own success message, and
another rendered a view claiming the account had one item when it had seven.
Partial payloads do not degrade to a smaller view; they degrade to a confidently
wrong one. Link widgets to the tools that can supply a complete payload.

**Widget-initiated `tools/call` back to the widget's OWN server works.** The
host bridge proxies the view's JSON-RPC `tools/call` requests to the server that
served the widget. This is the only channel out of the sandbox found to be
guaranteed; direct `fetch` to an external origin is governed by a
host-constructed `connect-src` and must be probed per host.

## What this implies for the server

The requirement the registry carries is narrower than the findings: advertise
`extensions: { "io.modelcontextprotocol/ui": {} }` on both eras, serve widget
resources under `ui://` with the MCP Apps mime type, and make sure every
`_meta.ui` resource link resolves to a resource that `resources/list` actually
returns. A dangling widget link and a wrong mime type both render as nothing at
all, with no error the server ever sees.
