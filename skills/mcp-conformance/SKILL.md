---
name: mcp-conformance
description: Test an MCP server over HTTP for spec conformance and cross-client compatibility, at the 2026-07-28 revision and the legacy revisions. Use when asked to check, gate, audit, or debug an MCP endpoint - whether it conforms to the spec, whether Claude / ChatGPT / Grok can actually use it, why a connector rejects it, or what a red conformance job means.
---

# MCP conformance

Three layers answer three different questions about an MCP HTTP endpoint. They
are not substitutes. Run the one that matches the question.

| Layer | Question | Whose definition of correct |
|---|---|---|
| Smoke | Has this server moved to the 2026-07-28 stateless core at all? | A third party |
| Spec gate | Does it do what the specification says? | The specification |
| Client matrix | Can each real client actually use it? | Each vendor |

Everything here is HTTP. Nothing in this skill tests a stdio server, and the
spec gate cannot: its server mode requires `--url`.

## Pick the layer

- **"Is my server ready for 2026-07-28?"** - smoke, 30 seconds, no checkout.
- **"Is this correct?" / a CI gate / an SDK or runtime under test** - spec gate.
- **"Claude connects but ChatGPT does not" / "the connector rejects it"** -
  client matrix. Vendor requirements are not spec requirements and the spec gate
  will not see them.
- **A red conformance job you did not write** - read *Reading a result* below
  before changing anything. Most red jobs name scenarios that cannot gate.

## Layer 1 - smoke

```bash
npx mcp-spec-check https://your-server.example/mcp
```

Eight black-box probes, no code access. Exit `0` ready, `1` a failing required
check, `2` could not test (auth-walled, unreachable, not MCP, or too ambiguous
to grade). Add `--bearer <token>` or `--header "K: v"` for an authed endpoint;
without a credential it classifies but cannot grade.

Only three checks can fail a server: `discover`, `routing-headers`,
`session-independence`. The other five warn.

**Do not treat a pass as conformance.** It is a readiness signal with real
blind spots - see `reference/tooling.md`, which lists what it does not probe.
Most relevant: its `discover` check only asserts a `supportedVersions` array,
so it passes a server whose `server/discover` result is missing `ttlMs`,
`cacheScope`, or `serverInfo` in `_meta` - the exact shape a strict client
rejects.

## Layer 2 - spec gate

```bash
# what does conforming to this revision actually require?
npx @modelcontextprotocol/conformance list --requirements 2026-07-28

# run exactly that
npx @modelcontextprotocol/conformance server --url http://127.0.0.1:3000/mcp \
  --requirements 2026-07-28
```

Use `--requirements <revision>`, not `--suite`. A suite description grows as
upstream adds scenarios, so a scenario merged after a revision shipped is
indistinguishable from one that existed at release: a green gate silently turns
red for work nobody was ever required to do. A requirement set is frozen at the
anchor release for that revision.

**Run it once per revision you support.** Scenarios run at the wire of their
revision - the dated revisions through `2025-11-25` use the `initialize`
handshake, `2026-07-28` is stateless with per-request `_meta`. A scenario
belonging to both emits different checks under each, so passing at one says
nothing about the other.

Version matters: `--requirements` needs `0.2.0-alpha` or newer. The `0.1.x` line
rejects `--spec-version 2026-07-28` outright and cannot measure the modern wire
at all. Pin an exact version so a green run means the same thing twice.

Two behaviours to know before wiring this into CI, both in
`reference/tooling.md`: `--expected-failures` mis-reconciles when combined with
`--requirements`, and the proxy variables must be cleared for a loopback run.

## Layer 3 - client matrix

The two gates in this repo. Point `example/src/server.ts` at your handler,
then:

```bash
bun install
bun test                                # gate 1: registry, mutation tests, client matrix
cd example && bun run test:inspector    # gate 2: the pinned MCP Inspector CLI
```

Gate 1 runs a typed profile per real client offline, in process. Gate 2 runs the
reference client over real loopback HTTP with the `--strict` schema-portability
lint at zero errors and zero warnings.

Set two lists in `example/test/conformance.test.ts`:

- `CLAIMS` - profiles you assert support for. These gate CI. A profile left out
  still runs and still reports; it just cannot fail the build.
- `KNOWN_GAPS` - accepted gating failures, by profile. The suite asserts the set
  is **exactly** this, so a new failure is red *and a fixed one is red too*.

Profile ids: `mcp-spec-baseline`, `claude-connectors`, `claude-code`,
`chatgpt-plugins`, `chatgpt-deep-research`, `openai-responses-api`,
`grok-connector`, `xai-api-remote-mcp`, `ide-remote-clients`, and the house
policy profile.

## Reading a result

**Not every failure counts.** The spec gate partitions scenarios it ran but did
not score, and names the reason. None of these can make a server nonconformant:

| Reason | Meaning |
|---|---|
| `extension` | Optional by definition (SEP-1730). Tasks and MCP Apps live here. |
| `pending` | The suite's own reference fixture cannot pass it yet. |
| `added-after-release` | Did not exist when the revision shipped. |

A red gate whose failures are all `tasks-*` is not a red gate. Check the
partition before implementing anything.

**In the client matrix, `inferred` confidence never gates.** Requirements carry
a citation and an honest confidence - `observed` beats `documented` beats
`inferred` - and an `inferred` requirement runs and reports but cannot fail a
build. That is deliberate: it stops a research guess becoming a mystery build
break. A skipped check declares `notApplicable` with a printed reason; there is
no silent pass.

**A baseline is a ledger, not a suppression list.** Whichever layer you gate on,
the honest contract is bidirectional: a new failure is red, and a baselined
scenario that starts passing is *also* red, so closing a gap deletes its entry
in the same commit. A gap list that only ever grows is how a matrix rots.

## Traps

These cost real debugging time. Details and evidence in
`reference/2026-07-28-wire.md`.

- **`initialize` cannot reach the modern era, by design.** It is always a legacy
  request, and the modern revision is not in the legacy echo set, so a client
  that opens with `initialize` will never see `2026-07-28`. Reaching it is
  `server/discover`, or a modern version marker on any request.
- **Header presence is not an era signal.** Legacy clients from `2025-06-18`
  onward are required to send `MCP-Protocol-Version` too. The *value* decides.
- **Compare version markers lexicographically on the raw string.** Do not
  gate on a `YYYY-MM-DD` shape first: `banana` and `draft` then fall into the
  legacy branch and get a silent downgrade, which is the one outcome the spec
  forbids. Compared as raw strings they sort above the modern floor and are
  correctly rejected with `-32022`.
- **Gate header/body validation on the detected era.** `Mcp-Method` and
  `Mcp-Name` do not exist in the legacy revisions, and `-32020` is a code no
  legacy client can interpret. A modern-aware client that falls back to the
  legacy lifecycle but keeps sending the headers will otherwise start eating
  400s.
- **A declared capability that answers `-32601` ends the session.** The
  Inspector gate exists because of exactly this: routes declared `logging` and
  answered `logging/setLevel` with method-not-found, so the reference client
  dropped the session before its first `tools/list`, and no in-house check
  noticed. Declare nothing you do not dispatch.

## Deliberately not covered

- **stdio servers.** No layer here tests one.
- **Authorization-server implementation.** The specification puts it out of
  scope, and the frozen requirement sets carry no authorization-server
  scenarios. The client matrix does check the OAuth *discovery* documents an MCP
  server serves.
- **Load, latency, cost.** Conformance only.
- **Whether a tool is any good.** Schema shape and portability, not usefulness.
