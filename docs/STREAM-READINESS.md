# EU5 stream-readiness rehearsal

The stream gate is a read-only acceptance harness. It consumes a monitoring
bundle and an append-only control ledger, produces a report, and exits non-zero
when evidence is missing or unsafe. It does not focus EU5, send input, edit a
save, invoke the debug console, or retry an action.

## Run it

```powershell
npm.cmd run stream:verify -- `
  --bundle .\private\rehearsal.monitoring.json `
  --ledger .\private\control-ledger.jsonl `
  --expectations .\private\stream-expectations.json `
  --output .\private\stream-readiness.md
```

Exit code `0` means every gate passed. Exit code `2` means the artifacts were
valid but the rehearsal is not stream-ready. Exit code `1` means an input file
or schema was invalid. Keep real saves, screenshots, logs, ledgers, and reports
outside Git.

## Rehearsal producer configuration

Start the control protocol for a rehearsal only after binding it to one
dedicated, empty ledger directory and the exact disposable campaign:

```powershell
$env:EU5_REHEARSAL_ID = "stream-rehearsal-1"
$env:EU5_REHEARSAL_CAMPAIGN_ID = "holland-stream-test"
$env:EU5_REHEARSAL_COUNTRY_ID = "HOL"
$env:EU5_CONTROL_DATA_DIR = "C:\private\eu5-stream-rehearsal"
```

The approval and independent-verifier HMAC secrets must also be supplied
through the local environment; never write them to the repository, monitoring
bundle, ledger, or report. Executable declarations fail closed when the
rehearsal session binding is absent. Use a new data directory for every
rehearsal: an existing malformed or differently bound ledger is rejected.

## Production capture

`StreamRehearsalCollector` in `src/stream/rehearsal-collector.js` is the
production converter from repeated `eu5.monitoring-feed/v1` snapshots to one
immutable `eu5.monitoring-bundle/v1` artifact. The coordinator supplies the
verified Phase 0 baseline digest, starts the explicit capture boundary, and
ingests each validated live-feed snapshot while the rehearsal runs.

The collector recomputes every live-feed manifest. It imports only records
bound to the exact rehearsal, campaign, and country. Feed-local health rows and
checkpoint metadata are not relabeled as campaign evidence. Instead, the
collector emits the four session-bound health components only when the final
validated feed proves the corresponding bridge and ledger sources available.

Action evidence is captured while the live feed classifies it as fresh and is
then retained immutably. This is capture-time freshness, not a claim that a
30-minute-old action is still current UI state. Current nation-domain telemetry
must still be captured within the report's 30-second freshness budget.
Bounded-time events are derived only from pairs of captured, independently
verified, paused nation snapshots; their immutable record digests become the
before/after evidence hashes.

To convert captured feed snapshots without writing custom code, store one
`eu5.monitoring-feed/v1` object as JSON, a JSON array of snapshots, or one
snapshot per line as JSONL. Then run:

```powershell
npm.cmd run stream:collect -- `
  --feeds .\private\live-feeds.jsonl `
  --session .\private\capture-session.json `
  --output .\private\rehearsal.monitoring.json
```

The capture-session file has this bounded shape:

```json
{
  "schemaVersion": "eu5.stream-rehearsal-capture/v1",
  "rehearsalId": "stream-rehearsal-1",
  "fingerprint": {
    "campaignId": "holland-stream-test",
    "countryId": "HOL",
    "gameBuild": "1.0.2",
    "modVersion": "0.4.0",
    "modManifestSha256": "64 lowercase hex characters",
    "seedSaveSha256": "64 lowercase hex characters"
  },
  "fingerprintEvidenceSha256": "64 lowercase hex characters",
  "startedAtUtc": "2026-07-26T10:00:00.000Z",
  "completedAtUtc": "2026-07-26T10:30:00.000Z",
  "boundedAdvances": [
    {
      "beforeRecordId": "player-summary-before",
      "afterRecordId": "player-summary-after",
      "maximumDays": 1,
      "recordedAtUtc": "2026-07-26T10:05:00.000Z"
    }
  ]
}
```

Inputs are limited to 16 MiB, 2,000 feed snapshots, and 1,994 bounded-advance
receipts. Each feed and final dashboard bundle is capped at 2,000 records; five
final records are reserved before completion. The command accepts only
`.json`/`.jsonl` feed inputs and a `.json` session file. It creates a new
`.json` bundle with exclusive-create semantics: it will not overwrite, target
an EU5 save, use a Windows alternate data stream, or alias an input artifact.
Rejected feeds are atomic and leave no partial records, counters, health, or
timestamps in the collector. Completion is staged too: if final bundle
validation fails, no completion or health records are committed and the
collector remains uncompleted.

## Expectations

The expectations file pins the disposable campaign. Hashes are lowercase
SHA-256 values.

```json
{
  "schemaVersion": "eu5.stream-readiness-expectations/v1",
  "fingerprint": {
    "campaignId": "holland-stream-test",
    "countryId": "HOL",
    "gameBuild": "1.0.2",
    "modVersion": "0.4.0",
    "modManifestSha256": "64 lowercase hex characters",
    "seedSaveSha256": "64 lowercase hex characters"
  }
}
```

Optional arrays and thresholds may only make a rehearsal stricter. They cannot
omit a default domain, navigation route, health component, or gameplay
capability, and they cannot lower a minimum or raise a maximum. The production
gate therefore cannot be weakened through an expectations file.

Verifier inputs are regular, non-symlink files capped at 16 MiB. Windows
alternate data streams are rejected before parsing.

## Monitoring evidence contract

The input is an `eu5.monitoring-bundle/v1` accepted by the existing dashboard
validator. Evidence used by the gate must be both `verified` and `fresh`.
`integrity.manifestSha256` must equal SHA-256 over the recursively key-sorted
JSON encoding of `schemaVersion`, `bundleId`, `generatedAtUtc`, `sourceMode`,
and `records`. Record sequences must be unique and contiguous from zero, and
timestamps cannot precede occurrence or extend past bundle generation.

The bundle must contain exactly one verified `rehearsal_started` and one
verified `rehearsal_completed` event for its `bundleId`; those explicit
boundaries must cover at least 30 minutes. It must also contain:

- a `health` record with `payload.component = "test-session"`,
  `payload.status = "available"`, and a `payload.fingerprint` exactly matching
  the expectations file;
- fresh healthy records for `test-session`, `mod-bridge`, `monitoring-feed`,
  and `control-ledger`;
- `nation_snapshot` records for `nation`, `economy`, `markets`, `diplomacy`,
  and `military`, all scoped to the expected campaign and country;
- at least three `game_event` records with
  `payload.eventType = "bounded_time_advance"`, `bounded`, `beforePaused`, and
  `afterPaused` set to true, an overshoot of at most one day, and before/after
  evidence hashes;
- at least 100 `llm_action_outcome` navigation records. Successes use
  `payload.actionFamily = "navigation"`, a named `procedure`,
  `outcome = "success"`, and a non-negative `latencyMs`.

The default navigation catalogue is:

- `open_control_panel`
- `open_capital`
- `economy`
- `markets`
- `diplomacy`
- `military`
- `alerts`

Every route needs at least three verified successes. Aggregate navigation must
reach 99% success, p95 latency at or below two seconds, and zero ambiguous or
`execution_unknown` outcomes.

The final rehearsal also requires three independently verified and correlated
capabilities: `economy_decision`, `diplomacy_decision`, and
`recruitment_inspection`. Every monitoring record and ledger lifecycle used by
the report must carry the bundle ID as its capture/rehearsal session and fall
inside the explicit start/completion window. Evidence from an earlier run
cannot satisfy the current rehearsal.

Final health claims for the mod bridge, monitoring feed, and control ledger
are bound to the ID, manifest hash, and generation time of the final validated
live-feed snapshot. An earlier healthy snapshot cannot carry status into a
later unhealthy feed.

The current v0.4.0 mod emits partial, unverified display-oriented observations.
They remain visible in `currentObservations`, but they do not become
`nation_snapshot` records and cannot satisfy stream readiness. A separate
verified typed producer is required for numeric nation statistics.

Required telemetry must reach the bundle within five seconds and the latest
record for every required domain must be no more than 30 seconds old at report
generation. Unknown data stays unknown; fixture or unverified records never
satisfy a gate.

## Ledger evidence contract

The ledger can be a JSON array or JSONL. Every record has a zero-based
`sequence`, `previousHash`, and `recordHash`. The first `previousHash` is null.
`recordHash` is SHA-256 over the stable, recursively key-sorted JSON encoding of
the record after removing `recordHash`. Any edit, deletion, or reorder fails the
integrity gate.

Each unique proposal correlation ID maps one-to-one to one terminal monitoring
outcome and one ledger declaration. Proposal, outcome, and declaration action
IDs must match; their action family and optional gameplay capability must also
match, as must their fixed procedure. Every ledger record also binds the
expected campaign and country. Each `declarationId` must have exactly one
of every state in this complete ordered lifecycle:

`declared → gated → confirmed → authorized → dispatched → acknowledged → verified`

The terminal `verified` record must also set `verified: true`. Failed, expired,
ambiguous, or unknown execution is retained as evidence but blocks release.
Any second terminal or any record after the terminal also blocks release.
The verifier never retries it.

## Release interpretation

The generated report is a release gate, not a claim that the harness controlled
the game. `stream_ready` means the supplied artifacts demonstrate the required
campaign fingerprint, health, observations, bounded pause behavior, navigation
quality, and complete verified action histories. A failed gate freezes the
rehearsal capability until new independent evidence is captured.
