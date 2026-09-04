# The tools, their exit codes, and what each one misses

Measured 2026-09-04. Every claim here came from running the tool, not from its
README.

## `@modelcontextprotocol/conformance` - the spec gate

The specification's own scenario suite. A Standards Track SEP cannot reach Final
until a matching scenario lands in it, and it is what the SDK tier system scores
official SDKs against. Nothing else here has that standing.

```bash
npx @modelcontextprotocol/conformance@<pin> list --requirements 2026-07-28
npx @modelcontextprotocol/conformance@<pin> server --url <url> --requirements 2026-07-28
```

Server-mode options: `--url`, `--scenario`, `--suite`, `--requirements`,
`--expected-failures`, `--spec-version`, `--force`, `-o/--output-dir`,
`--verbose`. `--timeout` is **client-mode only**. `authorization` is not a mode;
test authorization through a client or server scenario.

`-o <dir>` writes `checks.json` per scenario. Read it whenever a scenario fails
for a reason the summary line does not explain - it names each check and carries
the offending response. That file is how you tell a real defect from a missing
fixture.

### Version floor

`--requirements` and the frozen `requirements/<revision>.yaml` sets arrived in
the `0.2.0-alpha` line. The `0.1.x` line rejects `--spec-version 2026-07-28`
outright and cannot measure the modern wire at all. A gate pinned to `0.1.x` is
a legacy-only gate no matter what its job name says.

Pin an exact version. A floating range means a green run does not mean the same
thing twice, and it defeats a CI cache keyed on the pin.

### Two behaviours that will cost you a day

**`--expected-failures` mis-reconciles under `--requirements`.** Measured at
`0.2.0-alpha.11`. Passing both together makes the CLI drop the not-scored
partition from its output entirely, and report an "unexpected failures" list
unrelated to the run - in one measured case it named three scenarios that its
own SUMMARY block reported as `0 failed` in the same output, while the twelve
genuinely-failing `extension` and `pending` scenarios went unaccounted for. Exit
1 was not evidence of a regression.

Do the reconciliation yourself: parse the SUMMARY block, remove everything in
the not-scored partition, and compare that set against your ledger in both
directions. That also makes "not scored cannot gate" a property you can test
rather than one you inherit and cannot see.

**Clear the proxy variables for a loopback run.** The suite is a Node process
using undici, which honours `HTTP_PROXY`/`HTTPS_PROXY`. In a sandboxed CI runner
those are often set globally, so every request to `127.0.0.1` goes to the proxy
instead of the test server and the whole run dies as
`MCP error -32001: Request timed out` with nothing reaching the handler.
`NO_PROXY` alone is **not** enough - not every fetch stack consults it. Set
`HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy` and `https_proxy` to empty for the
child, and `NO_PROXY`/`no_proxy` to `127.0.0.1,localhost`.

### The not-scored partition

Scenarios the suite runs and reports without counting. The report names which
reason applies:

| Reason | Meaning |
|---|---|
| `extension` | Optional by definition. SEP-1730 exempts extensions (Tasks, MCP Apps) from every tier. |
| `added-after-release` | Did not exist when the revision shipped, so nothing pinning a published referee could have been running it. |
| `pending` | The reference fixture of the suite cannot pass it yet, so it cannot be required - but the implementation under test may pass it, so it runs for visibility. |

A requirement set is frozen and `not_scored` is part of that contract.
Promoting an entry into the required list is a deliberate, reviewable upstream
change - which is how the suite grows without retroactively failing anyone.

Note the asymmetry with a baseline: a requirement set lives upstream and says
what a revision demands; an expected-failures baseline lives in your repo and
records what you know you fail. **A baselined failure is still a failure against
a requirement set.**

## `mcp-spec-check` - the smoke test

```bash
npx mcp-spec-check <url> [--json] [--verbose] [--timeout 30000]
npx mcp-spec-check <url> --bearer <token>
npx mcp-spec-check <url> --header "X-Api-Key: k"     # repeatable
```

Exit `0` ready, `1` at least one failing required check, `2` could not test
(probe error, auth-walled, unreachable, not MCP, or answers too ambiguous to
grade). Zero runtime dependencies, pure black-box HTTP.

Eight checks. Only the first three decide the verdict:

| Check | Gates | Covers |
|---|---|---|
| `discover` | yes | `server/discover` implemented |
| `routing-headers` | yes | `Mcp-Method` / `Mcp-Name` required and mismatches rejected |
| `session-independence` | yes | no protocol-level session |
| `error-codes` | warn | `-32002` renumbered to `-32602` |
| `cache-metadata` | warn | `ttlMs` / `cacheScope` present |
| `mrtr` | warn | results carry `resultType` |
| `deprecated-features` | warn | reliance on deprecated Logging or removed `resources/subscribe` |
| `auth-metadata` | warn | RFC 9728 protected-resource metadata |

**Its constants are trustworthy; its coverage is shallow.** The error
renumbering, the five-method cacheable list, the routing-header rule and the
`supportedVersions` field name all match the final specification. What it does
not do:

- `discover` asserts only that `supportedVersions` is an array containing the
  target. It does **not** check `ttlMs`, `cacheScope`, or `serverInfo` in
  `_meta` on that result - so it passes a server emitting a stale draft shape
  that a strict client rejects before `tools/list`.
- No coverage of `subscriptions/listen`, the removal of `ping` /
  `logging/setLevel`, the removal of SSE resumability, JSON Schema 2020-12
  loosening, or the `extensions` field.
- `resultType` on all results is warn-level only, inside the `mrtr` check.
- Its deprecated-capability list covers Logging and `resources/subscribe`,
  missing Roots and Sampling.

By design it is conservative: anything ambiguous is `inconclusive`, never a
fail. Few false positives, many false negatives. Treat a pass as "has started
migrating", never as "conforms".

Also note the pin: the published version was verified against the `/draft` docs
shortly before GA. Re-check its constants against the dated specification URLs
before relying on it for anything load-bearing.

## MCP Inspector CLI - the reference client

Runs the official SDK client against your server end to end, plus a `--strict`
schema-portability lint. Hold that lint at zero errors **and zero warnings**: a
warning names a construct real clients mishandle.

It is worth its own gate because it catches a class the other layers cannot -
whether the client everyone debugs against can complete a session at all. In
one measured case every route declared the `logging` capability and answered
`logging/setLevel` with `-32601`, so the Inspector dropped the session before
its first `tools/list`, and every in-house check passed against it.

Install it out of band. It is ~117 MB and serves one job, so it does not belong
in a workspace dependency graph; put it in a cache directory keyed on the file
that holds the pin. Make a missing binary a hard failure in CI - otherwise the
gate passes by testing nothing.

## What not to reach for

- **`mcp-conformance-kit`** (Python, stdio + HTTP) grades against the 2025-era
  spec. Its lifecycle check asserts `initialize` returns
  `protocolVersion`/`capabilities`/`serverInfo` - a handshake removed in
  2026-07-28. No modern-era awareness, and no LICENSE file.
- **Spec-diffing "skills" that compare revision text.** Several exist. The ones
  measured carried fabricated invariants and did not cover 2026-07-28.
- **A single tool as the whole answer.** The spec gate cannot see vendor
  requirements; the client matrix runs your own reading of the spec; the smoke
  test grades three checks. Each is blind where the others look.
