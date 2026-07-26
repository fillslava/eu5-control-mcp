# EU5 before / after dashboard: implementation and evidence protocol

## Status

The repository contains a local, dependency-free dashboard shell for comparing
two JSON snapshots. It is useful for exercising the comparison contract and
reviewing provenance, but it does not yet have a verified EU5 metric source.

**No real before/after metric pair has been captured.** The only bundled pair is
`dashboard/example.snapshot-pair.json`, which is synthetic fixture data. It must
never be presented as a campaign observation or used to support a gameplay
decision.

This document defines the source admission, capture, pairing, and promotion
gates that a real pair must pass. Passing the dashboard's JSON validation alone
is not source verification.

## Current repository capabilities

| Component | What it does now | What it does not establish |
| --- | --- | --- |
| `dashboard/index.html`, `app.js`, and `styles.css` | Open locally, accept a pair JSON file or separate before/after snapshot files, validate their structure, compare state fields, and render the result. | They do not read EU5, call the MCP server, capture a screen, parse a save, or verify a provenance claim. |
| `dashboard/example.snapshot-pair.json` | Exercises fixture labeling plus changed, unchanged, and unknown rendering. | It contains no real EU5 state. |
| `eu5_list_save_checkpoints` | Inventories `.eu5` files and reports relative name, size, modification time, and SHA-256. | Save metadata and hashes are not game metrics, and the tool does not parse save contents. |
| `eu5_observe_checkpoint` | Reports metadata for the newest `.eu5` file without hashing or parsing it. | It cannot produce a dashboard snapshot or prove campaign identity from contents. |
| `eu5_list_debug_exports` | Inventories metadata for the bounded debug-output patterns without reading file contents. | It does not identify an export schema or supply metric values. |
| Navigation preparation and validation | Return finite procedures for opening verified views such as Economy; provisional click candidates remain non-operational without fresh target verification. | Returning or sending a navigation procedure is not a data capture and does not prove the expected UI appeared. |
| `src/read/market-export.js` | Parses a bounded, synthetic three-column TSV contract, with 1 MiB and 10,000-row limits. | Its format is fixture-derived and unverified. It is not compatible with the locally documented command output described below. |
| `src/control/market-export-contract.js` | Describes `export_market_capacity` as blocked by policy, ineligible for execution, and parameter-free. | It never executes the command. Neither this contract nor the parser is registered as an MCP tool in `src/server.js`. |
| `mod/eu5-control-debug` | Provides an uninstalled, effect-free scripted-GUI scaffold. | It has no GUI attachment, performs no export, and is not a metric source. |

The source readers and dashboard are therefore disconnected by design. There is
currently no production adapter that can turn a verified, real EU5 artifact
into `eu5.before-after-dashboard.snapshot/v1`.

## Market-export incompatibility

The existing market parser must not feed dashboard data.

The locally generated `console.txt` command catalogue describes
`export_market_capacity` as exporting a tab-separated file with these fields:

1. market name;
2. trade capacity;
3. burgher trade capacity;
4. oversupply;
5. undersupply;
6. total imbalance.

By contrast, `src/read/market-export.js` accepts exactly:

```text
market_id	good_id	capacity
```

Its tests use invented Amsterdam/grain and Antwerp/iron rows. The fixture has a
different column count and different field meanings from the local command
description. Parser test success proves only that the synthetic three-column
fixture is handled consistently. It does not validate the game command, its
output path, its actual header, row grain, units, or semantics.

Consequences:

- Do not load parser results into a dashboard snapshot, even as
  `candidate-snapshot-pair`.
- Do not rename or positionally map the three fixture fields to the six
  described fields.
- Do not mark the parser's `fixture-derived-unverified` result as verified.
- Do not run `export_market_capacity` to obtain a sample under the current
  protocol. The command remains blocked by the no-console policy.
- Do not use save hashes, debug-export file metadata, or the example dashboard
  fixture as substitutes for market values.

A future market adapter requires a separately reviewed source-acquisition path,
an actual authorized artifact, fixed field and unit definitions, and regression
fixtures derived from that artifact. Until all four exist, market capacity is
not an admitted dashboard source.

## Safety boundary

The dashboard adds no authority to observe or control the live game. The
existing supervised protocol remains controlling:

- Never use console commands, cheats, account features, cloud sync, or external
  communication.
- Never install or enable the debug scaffold, attach it to game UI, or invoke a
  console command as part of dashboard capture.
- Never modify, create, overwrite, rename, move, upload, or delete a save on the
  supervisor's behalf.
- Keep any game navigation separately supervised, paused, atomic, and followed
  by fresh visible verification. Opening a panel grants no authority to change
  a value, advance time, acknowledge a dialog, or issue an order.
- Stop on an unexpected modal, uncertain country/save, stale observation,
  foreground mismatch, unplanned time advance, or supervisor `STOP`.
- Keep real source artifacts local and outside Git. Do not commit saves,
  screenshots containing personal information, console output, machine-specific
  paths, or generated campaign data.

The static dashboard itself:

- reads only files explicitly selected in the browser;
- makes no network request and has no telemetry or background game access;
- does not persist imported data, so a refresh or **Clear** removes it from the
  page;
- writes imported values with `textContent`, not as executable HTML.

These properties protect the display path. They do not make an untrusted source
accurate.

## Canonical capture and pairing protocol

Capture is an upstream evidence workflow. The dashboard is the final reader.
Implement the workflow in the following order and fail closed at every gate.

### 1. Admit one source adapter

Before any real capture, record and review:

- a stable adapter identifier and version;
- the exact source artifact type;
- how the artifact is obtained without crossing the safety boundary;
- the fixed metric names, row/entity grain, types, units, locale rules, and
  missing-value rules;
- maximum accepted bytes, rows, fields, and nesting depth;
- the raw-artifact hashing and retention policy;
- real-artifact-derived positive and negative fixtures.

An adapter remains unverified if any format knowledge comes only from a command
description, an invented fixture, a UI label guess, or a parser that has not
been checked against the exact source artifact.

### 2. Declare the comparison scope

Create one capture-session record before taking the first snapshot. It must
identify, without exposing private paths:

- a unique capture-session ID;
- the intended campaign/save checkpoint;
- controlled country;
- panel or source kind;
- compared entity, such as one named market;
- exact metric allowlist and units;
- adapter ID and version;
- game build and UI locale when relevant;
- the separately authorized test segment between captures.

Do not begin if the same identity and field definitions cannot be reproduced
for the after capture.

### 3. Capture the before state

1. Confirm the intended disposable campaign, country, scope, and paused state.
2. Stop for a modal, text field, uncertain identity, or unreliable observation.
3. Obtain the source artifact through the admitted read-only path.
4. Preserve or reference the raw artifact immutably and compute that capture's
   own SHA-256.
5. Record wall-clock capture time in UTC and source-provided game time, or
   `null` when game time is not available.
6. Parse only the declared metric allowlist with the admitted adapter.
7. Compare parsed values with the raw evidence. Mark the snapshot `verified`
   only after that review; otherwise mark it `unverified`.
8. Emit a snapshot with role `before`.

The evidence string should be concise but auditable, for example:

```text
adapter=<id>@<version>; raw_sha256=<sha256>; scope=<scope-id>; review=<result>
```

Do not place a private absolute path, credential, or console content in the
evidence string.

`rawContentSha256` identifies the raw artifact for one capture. The before and
after snapshots each require their own valid hash; the hashes are not a shared
pair identifier. Separate before/after artifacts should normally have different
hashes, and the current dashboard requires them to differ before a pair can be
classified as verified.

### 4. Keep the test segment outside the dashboard

The dashboard never initiates the event being measured. A human supervisor and
the existing action gate own any intervening action or time advance. Record the
exact approved segment and its visible result. If the action differs, the game
unpauses unexpectedly, or identity becomes uncertain, abandon the pair.

An abandoned before snapshot may remain as evidence, but it must not be paired
with a later unrelated observation.

### 5. Capture the after state

Repeat the before procedure with role `after`. Use the same:

- capture-session ID;
- campaign/save lineage and controlled country;
- source kind and adapter version;
- entity key, field allowlist, types, units, and locale;
- verification method.

The after wall-clock timestamp must be strictly later than the before timestamp.
Changing the field set to make a result look complete is prohibited. A missing
or unreadable value stays missing or `null` and will render as `unknown`.

### 6. Correlate and classify the pair

The pair generator, not the browser, must verify:

- both snapshots belong to the same declared capture session and entity;
- after descends from the intended before checkpoint rather than a different
  save or country;
- each snapshot has its own valid raw-artifact hash;
- the adapter ID/version and field-definition fingerprint match;
- the after time is later;
- the field set and definitions are identical;
- no fixture value is mixed with real observations;
- each `verified` claim is backed by reviewed raw evidence.

Choose the least-privileged classification:

| Classification | Required provenance | Dashboard result |
| --- | --- | --- |
| `fixture-example` | Core provenance fields are present and correlated; both snapshots have verification status `fixture`. | Persistent fixture warning; never real evidence. |
| `candidate-snapshot-pair` | Core provenance fields are present and correlated; neither snapshot is `fixture`; one or both may be `unverified`. | Loaded but always shown as not fully verified, even if both snapshot statuses say `verified`. |
| `verified-snapshot-pair` | Core provenance fields are present and correlated; both snapshots are `verified` and `fresh`; `source.kind` matches; the two valid raw-artifact hashes are distinct. Every upstream truth/evidence gate must also pass. | Shown as **Verified snapshots loaded**. |

Use `candidate-snapshot-pair` whenever the source adapter, raw evidence,
freshness, or human review is incomplete but the required correlation fields
can still be truthfully supplied and matched. A structural mismatch in capture
session, entity, adapter, or field-definition fingerprint is rejected rather
than downgraded to a candidate.

### 7. Hand only the normalized pair to the dashboard

The canonical reader payload is:

```json
{
  "schemaVersion": "eu5.before-after-dashboard.pair/v1",
  "classification": "candidate-snapshot-pair",
  "displayLabel": "Descriptive label, not a verification claim",
  "before": {
    "schemaVersion": "eu5.before-after-dashboard.snapshot/v1",
    "role": "before",
    "snapshotId": "stable-before-evidence-id",
    "captureSessionId": "shared-capture-session-id",
    "entityId": "shared-entity-id",
    "adapter": {
      "id": "manual-ui-observation",
      "version": "1.0.0"
    },
    "rawContentSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "fieldDefinitionFingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "capturedAt": "2026-01-01T12:00:00.000Z",
    "gameTime": null,
    "source": {
      "label": "Admitted source label",
      "kind": "manual-ui-observation",
      "freshness": "unknown",
      "verification": {
        "status": "unverified",
        "evidence": "adapter=manual-ui-observation@1.0.0; raw_sha256=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc; scope=shared-entity-id"
      }
    },
    "state": {
      "metric_namespace": {
        "metric_key": null
      }
    }
  },
  "after": {
    "schemaVersion": "eu5.before-after-dashboard.snapshot/v1",
    "role": "after",
    "snapshotId": "stable-after-evidence-id",
    "captureSessionId": "shared-capture-session-id",
    "entityId": "shared-entity-id",
    "adapter": {
      "id": "manual-ui-observation",
      "version": "1.0.0"
    },
    "rawContentSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "fieldDefinitionFingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "capturedAt": "2026-01-01T12:01:00.000Z",
    "gameTime": null,
    "source": {
      "label": "Admitted source label",
      "kind": "manual-ui-observation",
      "freshness": "unknown",
      "verification": {
        "status": "unverified",
        "evidence": "adapter=manual-ui-observation@1.0.0; raw_sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; scope=shared-entity-id"
      }
    },
    "state": {
      "metric_namespace": {
        "metric_key": null
      }
    }
  }
}
```

This is a shape example, not a real capture. Placeholder and `null` values must
not be promoted to verified observations.

## Dashboard sections and comparison behavior

The page renders six operator-facing areas:

1. **Overall status** — awaiting, fixture, not fully verified, or verified.
2. **Input** — one pair file, or separate before and after files. Separate files
   are conservatively wrapped as `candidate-snapshot-pair`.
3. **Fixture warning** — visible only for `fixture-example`.
4. **Before and After provenance cards** — source label and kind, capture time,
   game time, freshness, and verification status. Verification evidence is
   available as the verification badge's title.
5. **Comparison summary** — changed, unchanged, and unknown field counts.
6. **Field details** — dotted field path, before value, after value, status, and
   an all/changed/unchanged/unknown filter.

Nested plain objects are flattened to sorted dotted paths. Arrays remain atomic
values. A field is:

- `changed` when both sides are known and their stable values differ;
- `unchanged` when both sides are known and their stable values match;
- `unknown` when either side is missing, `null`, or undefined.

Unknown is an evidence state, not a zero. Consumers must not calculate a delta
from an unknown field.

## Validation and promotion gates

### Enforced by the current dashboard

- Exact pair and snapshot schema-version strings.
- Pair classification from the three values listed above.
- Non-empty pair label, snapshot ID, capture-session ID, entity ID, adapter ID
  and version, source label, source kind, and verification evidence.
- A valid 64-character lowercase hexadecimal `rawContentSha256` and
  `fieldDefinitionFingerprint` on each snapshot.
- Different before/after snapshot IDs.
- Matching `captureSessionId`, `entityId`, `adapter.id`, `adapter.version`, and
  `fieldDefinitionFingerprint` across every pair.
- Correct before/after role.
- Calendar-valid canonical UTC capture timestamps in
  `YYYY-MM-DDTHH:mm:ss(.sss)?Z` form, with after strictly later than before.
- `gameTime` as a string or `null`.
- Freshness as `fresh`, `stale`, or `unknown`.
- Verification status as `verified`, `unverified`, or `fixture`.
- Plain-object snapshot state containing only finite JSON data, with non-empty
  field keys that do not contain dots and no circular or shared references.
- Input and rendering limits: 1 MiB per selected file checked before and after
  reading; nesting depth 16; 2,000 object keys plus array entries per snapshot;
  250 entries per array; and 2,000 unioned comparison rows.
- Classification/status consistency: verified pairs require two verified and
  fresh snapshots, matching `source.kind`, and distinct before/after
  `rawContentSha256` values; fixture pairs require two fixture snapshots;
  candidate pairs reject fixture snapshots and never enter the ready state.
- Invalid JSON or a validation error clears the comparison and reports the
  reason.
- Imported text is rendered without `innerHTML`.

### Not enforced by the current dashboard

- Correctness of the parser or manual transcription.
- Raw artifact existence, immutability, or retention, or whether a supplied
  hash actually belongs to that artifact.
- Truth of the self-asserted capture-session ID, entity ID, adapter identity,
  field-definition fingerprint, source kind, freshness, verification status, or
  verification evidence.
- Same campaign, save lineage, country, market/entity, game build, locale,
  units, or field definitions beyond comparing the supplied correlation
  strings.
- Whether the field-definition fingerprint was computed from a reviewed
  registry or actually describes the supplied state.
- A non-empty state or a common field set. Missing fields remain an allowed,
  explicit `unknown` comparison.

Therefore an upstream generator must apply the canonical correlation gates.
The renderer can reject missing, malformed, mismatched, stale, or internally
inconsistent claims, but it cannot independently prove that matching strings,
hashes, fingerprints, or evidence statements are truthful.

Run the focused contract tests after any dashboard change:

```powershell
node --test tests/before-after-dashboard.test.js
```

Run the complete repository suite before promotion:

```powershell
npm test
npm run check
```

## Next proof of concept

The next POC should prove one real metric pair without console access, save
parsing, mod installation, or automated game control.

Use two human-supplied, already captured observations of the same visible,
read-only EU5 panel from the same disposable campaign. Select one consistently
labeled metric whose entity and unit are visible in both observations. Do not
preselect the synthetic market fields and do not infer a value hidden by the UI.

Implement a small `manual-ui-observation/v1` adapter that:

1. accepts only the declared capture-session ID, role, timestamps, game/country
   scope, panel/entity, adapter ID/version, metric key, displayed value and
   unit, source kind, that capture's raw-evidence hash, and the shared reviewed
   field-definition fingerprint;
2. rejects mismatched scope, locale, metric label, unit, or adapter version;
3. emits two `snapshot/v1` documents with `unverified` provenance by default;
4. emits a `candidate-snapshot-pair` after the correlation checks pass;
5. allows promotion to `verified-snapshot-pair` only after a human checks both
   transcriptions against their immutable evidence, both observations are
   fresh, their source kinds match, and their per-capture raw hashes are valid
   and distinct.

POC acceptance criteria:

- no console command, debug mode, mod, save mutation, or agent-driven game
  action is used;
- both source observations are real, local, same-scope, and hash-addressed;
- raw observations and generated campaign data remain uncommitted;
- a deliberately mismatched entity/unit pair is rejected;
- a missing value renders `unknown`, not zero or unchanged;
- the real pair contains no fixture labels or values;
- focused dashboard tests and the complete repository suite pass.

Only after this POC is repeatable should the project consider a richer
source-specific parser. Market export remains blocked until its acquisition
policy and real six-field artifact contract are independently resolved.
