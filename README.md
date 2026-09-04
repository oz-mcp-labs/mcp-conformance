# mcp-conformance

Two CI gates for an MCP server, and a worked example wiring them to one.

- **Gate 1 — the client matrix.** A typed profile per real MCP client (Claude
  connectors, Claude Code, ChatGPT, the OpenAI Responses API, Grok, the xAI API,
  IDE clients, the spec floor, plus your own house policy), an executable check
  per requirement, and a report saying which clients your endpoint is *proven*
  to work with. Runs offline, in process. No deployment, no credentials, no
  network.
- **Gate 2 — the reference client.** The official
  [MCP Inspector CLI](https://github.com/modelcontextprotocol/inspector), pinned,
  driven against your server over real loopback HTTP, plus its `--strict`
  schema-portability lint held at zero errors and zero warnings.

You want both, and the reason is the whole design. Gate 1 runs *our* checks with
*our* probe, so it cannot catch a case where our reading of the spec is wrong.
Gate 2 runs the client everyone debugs against — but only that one client, so it
is not provider coverage. In the codebase this was extracted from, gate 2's first
run could not get past connect: every route declared the `logging` capability and
answered `logging/setLevel` with `-32601`, so the Inspector dropped the session
before its first `tools/list`. Every check in gate 1 passed against it.
`example/test/inspector.test.ts` reproduces that failure on purpose.

## Quick start

```bash
bun install
bun test                       # gate 1: registry, mutation tests, client matrix
cd example && bun run test:inspector   # gate 2: installs the pinned CLI, runs the suite
```

Copy `.github/workflows/mcp-conformance.yml` into your repo for both jobs.

## Layout

```
packages/mcp-conformance/   the library
  src/profiles/             one file per vendor; edit platform-policy.ts for house rules
  src/checks/               executable checks, grouped by surface area
  src/example-server.ts     a known-good dual-era server, with switchable defects
  src/inspector.ts          the Inspector pin, argv, and output parsing
  test/                     registry integrity + one mutation test per check
example/                    the seam: wire the gates to your server
  src/server.ts             REPLACE THIS
  test/conformance.test.ts  gate 1
  test/inspector.test.ts    gate 2
  scripts/inspector.ts      installs the pinned CLI and runs gate 2
docs/                       the documents the profiles cite
```

## Pointing it at your server

Edit `example/src/server.ts`. Both gates drive a
`(request: Request) => Response` handler and nothing else:

```ts
export function createServer() {
  return {
    fetch: myMcpHandler,          // the MCP endpoint
    originFetch: myWellKnown,     // same-origin .well-known documents
    origin: 'https://mcp.example.com',
    path: '/mcp',
  }
}
```

Then set two lists in `example/test/conformance.test.ts`:

- `CLAIMS` — the profiles you assert support for. These gate CI. A profile left
  out still runs and still reports; it just cannot fail the build.
- `KNOWN_GAPS` — the gating failures you have accepted, by profile. The suite
  asserts the set is **exactly** this, so a new failure is red *and a fixed one
  is red too*, until you delete the entry. A gap list that only ever grows is
  how a compatibility matrix rots.

If authenticating your handler reaches a database, mock the authenticator rather
than the route. Everything downstream — dispatch, catalogue, scopes, CORS, era
negotiation — then stays the real code path, and the anonymous 401 stays real,
which is what the OAuth discovery checks hang off.

## Two rules the registry is built on

**An unsourced belief never gates.** Every requirement carries at least one
citation and an honest confidence: `observed` (we watched a real client do this)
beats `documented` (the vendor or the spec says so, at a URL fetched on a
recorded date) beats `inferred` (reasoned from adjacent facts). **`inferred`
never gates.** It runs and it reports, but it cannot fail a build — which is what
stops a research guess from becoming a mystery build break six months later.
A fact that cannot be sourced belongs in a profile's `unknowns` with a proposed
experiment, not in `requirements` with a hopeful confidence.
`test/registry.test.ts` enforces this mechanically.

**A skip is always accounted for.** A target that structurally cannot answer a
check declares it in `notApplicable` with a reason, and the reason is printed.
There is no silent pass.

## Calibration

A check suite that has never run against a known-good server cannot tell "the
surface is broken" from "the check is broken". `src/example-server.ts` is that
known-good server — a minimal dual-era implementation written to satisfy every
check — and it takes a `break` option that flips exactly one behavior at a time.
`test/checks.test.ts` asserts that each mutation turns exactly the corresponding
check red. It doubles as the shortest readable statement of what the registry
actually demands.

## Adding a profile

Every requirement needs at least one citation and an honest confidence. Add the
file under `src/profiles/`, register it in `src/profiles/index.ts`, and if it
needs a check that does not exist yet, add the check plus its mutation to
`src/example-server.ts` and `test/checks.test.ts` in the same change.

## The Inspector pin

`src/inspector.ts` holds the pinned version, the argv construction, and the
output parsing; it is on `node:fs`/`node:path` so it runs under both Bun and
Node. Spawning and serving are runtime-specific and live with each caller
(`example/test/helpers/inspector.ts` is the Bun half). If you drive the CLI from
two runners — a Bun suite and a vitest suite over a second route implementation,
say — they share this module so the pin, the flags and the output reading cannot
drift, which is how one of them would silently stop testing anything.

The CLI is deliberately **not** a dependency: it installs ~117 MB that every
`bun install` would otherwise pay for to serve one job. It lands in
`node_modules/.cache/mcp-inspector` instead, which git ignores and CI caches on
the hash of `src/inspector.ts`, so a pin bump reinstalls and nothing else does.
Without the binary the suite skips; `MCP_INSPECTOR_REQUIRED=1` — which the runner
script and the CI job both set — turns a missing binary into a failure, so the
gate cannot pass by testing nothing.

## License

Apache License 2.0. See [LICENSE](./LICENSE).
