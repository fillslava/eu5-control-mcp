# EU5 before / after dashboard

This is a dependency-free, local-only HTML dashboard for comparing two explicitly
supplied EU5 state snapshots. It does not read saves, control the game, call a
server, or upload data. Open `index.html` directly in a browser and select either
one snapshot-pair JSON file or separate before and after JSON files.

The initial state intentionally contains no game values and says **Awaiting
verified snapshots**. `example.snapshot-pair.json` is a synthetic fixture for
demonstrating the contract and renderer. It is labeled **FIXTURE / EXAMPLE — NOT
REAL EU5 STATE** in both the file and the dashboard and must not be used as
operational evidence.

## Pair contract

```json
{
  "schemaVersion": "eu5.before-after-dashboard.pair/v1",
  "classification": "fixture-example",
  "displayLabel": "SYNTHETIC FIXTURE / EXAMPLE - NOT REAL EU5 STATE",
  "before": {
    "schemaVersion": "eu5.before-after-dashboard.snapshot/v1",
    "role": "before",
    "snapshotId": "fixture-before",
    "captureSessionId": "fixture-session",
    "entityId": "fixture-entity",
    "adapter": {
      "id": "fixture-adapter",
      "version": "0.0.0-fixture"
    },
    "rawContentSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "fieldDefinitionFingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "capturedAt": "2000-01-01T00:00:00.000Z",
    "gameTime": null,
    "source": {
      "label": "Synthetic dashboard fixture",
      "kind": "fixture-example",
      "freshness": "unknown",
      "verification": {
        "status": "fixture",
        "evidence": "Example structure only; not observed from EU5."
      }
    },
    "state": {}
  },
  "after": {
    "schemaVersion": "eu5.before-after-dashboard.snapshot/v1",
    "role": "after",
    "snapshotId": "fixture-after",
    "captureSessionId": "fixture-session",
    "entityId": "fixture-entity",
    "adapter": {
      "id": "fixture-adapter",
      "version": "0.0.0-fixture"
    },
    "rawContentSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "fieldDefinitionFingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "capturedAt": "2000-01-01T00:01:00.000Z",
    "gameTime": null,
    "source": {
      "label": "Synthetic dashboard fixture",
      "kind": "fixture-example",
      "freshness": "unknown",
      "verification": {
        "status": "fixture",
        "evidence": "Example structure only; not observed from EU5."
      }
    },
    "state": {}
  }
}
```

`classification` is one of:

- `verified-snapshot-pair`, which requires both snapshot verification statuses
  to be `verified`, both freshness values to be `fresh`, and every verified-pair
  invariant below to pass;
- `candidate-snapshot-pair`, which accepts `verified` and `unverified` snapshot
  statuses but is never presented as ready or verified overall;
- `fixture-example`, which requires both snapshot verification statuses to be
  `fixture`.

Fixture provenance is reserved for `fixture-example` pairs. Individually selected
before and after files are conservatively treated as a candidate pair.

Every pair classification requires:

- different `snapshotId` values;
- exactly matching `captureSessionId`, `entityId`, `adapter.id`,
  `adapter.version`, and `fieldDefinitionFingerprint`;
- a present, valid 64-character lowercase hexadecimal `rawContentSha256` on
  each snapshot;
- an after `capturedAt` instant strictly later than the before instant.

These checks are fail-closed: a pair classified as verified is rejected instead
of being silently demoted when any requirement fails. Candidate pairs can carry
unverified provenance, but never produce the dashboard's ready state.

Verified pairs additionally require matching `source.kind` values and distinct
`rawContentSha256` values. The hashes identify two separate raw capture
artifacts, so equality is not evidence of a valid before/after capture.

## Snapshot contract

```json
{
  "schemaVersion": "eu5.before-after-dashboard.snapshot/v1",
  "role": "before",
  "snapshotId": "stable-source-identifier",
  "captureSessionId": "shared-capture-session",
  "entityId": "shared-entity-identifier",
  "adapter": {
    "id": "adapter-identifier",
    "version": "adapter-version"
  },
  "rawContentSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "fieldDefinitionFingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "capturedAt": "2026-01-01T12:00:00.000Z",
  "gameTime": "source-provided game time, or null",
  "source": {
    "label": "Source description",
    "kind": "parser-or-export-kind",
    "freshness": "fresh",
    "verification": {
      "status": "verified",
      "evidence": "How this snapshot was verified"
    }
  },
  "state": {
    "any": {
      "schema-aware": "JSON state values"
    }
  }
}
```

For the after snapshot, `role` must be `after`. `capturedAt` accepts only
canonical UTC `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.sssZ` with a real
calendar date in years 0001–9999. Offsets, spaces, omitted zero padding,
non-three-digit fractional seconds, leap seconds, and normalized invalid dates
are rejected. The after instant must be strictly later than the before instant.
`gameTime` is displayed exactly as supplied because the dashboard does not infer
EU5 calendar semantics.

Allowed provenance values:

- `source.freshness`: `fresh`, `stale`, or `unknown`
- `source.verification.status`: `verified`, `unverified`, or `fixture`

The renderer flattens nested state objects into dotted field paths. Input key
segments therefore cannot be empty or contain `.`; rejecting them prevents two
different source shapes from collapsing to the same displayed path. Arrays
remain single displayed values. A field is:

- **changed** when both snapshots supply known, unequal values;
- **unchanged** when both snapshots supply known, equal values;
- **unknown** when either side is missing, `null`, or undefined.

All imported labels and values are written to the page as text, not interpreted
as HTML.

## Input and rendering bounds

Inputs are rejected before rendering when they exceed any fixed local bound:

- selected JSON file: 1,048,576 bytes (1 MiB), checked before and after reading;
- state nesting: 16 container levels after the root;
- state fields: 2,000 object keys and array entries per snapshot;
- array length: 250 elements;
- comparison detail: 2,000 unioned field rows.

State validation uses bounded iterative traversal, rejects circular/shared
non-JSON object graphs when called programmatically, and accepts only finite JSON
values. A rejected input clears the comparison instead of showing partial data.

## Source limitations

The dashboard validates the JSON contract, exact provenance tuple equality,
hash/fingerprint syntax, freshness/status gates, and capture chronology. It does
not compute the supplied hashes, authenticate provenance claims, prove that an
adapter is correct, prove that a save/export belongs to the intended campaign,
or prove that matching entity/session identifiers are truthful. Those checks
must happen at the source. An `unverified` or `fixture` snapshot stays visibly
non-verified in the UI.

Because the page is static, browser refreshes clear all loaded data. This is
intentional: there is no persistence, telemetry, network request, or background
game access.

## Optional monitoring bundle

The separate **Monitoring bundle JSON** picker accepts only a local
`eu5.monitoring-bundle/v1` document with `sourceMode: "offline-import"`. It
shows records grouped as an action ledger, health, action/event timeline, nation
snapshots, and provenance. Loading it does not modify or promote the before/after
comparison state.

```json
{
  "schemaVersion": "eu5.monitoring-bundle/v1",
  "bundleId": "local-export-id",
  "generatedAtUtc": "2026-07-26T12:00:00.000Z",
  "sourceMode": "offline-import",
  "records": [],
  "integrity": { "manifestSha256": "optional lowercase SHA-256" }
}
```

Each record must include identifiers, canonical occurrence/recording timestamps,
a non-negative sequence, `subject`, `payload`, and provenance (adapter,
freshness, and verification evidence). Supported types are
`llm_action_proposed`, `llm_action_outcome`, `nation_snapshot`, `game_event`,
and `health`. The dashboard does not verify a supplied hash or prove a source;
missing integrity metadata, unverified records, fixture records, stale records,
and unknown freshness remain visible as warnings. Imports containing local paths
or secret-bearing field names are rejected.
