"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  LIMITS,
  buildModel,
  compareStates,
  emptyModel,
  escapeHtml,
  parseCanonicalUtcTimestamp,
  readJsonFile,
  validateStateBounds,
  validatePair
} = require("../dashboard/app");

const dashboardRoot = path.join(__dirname, "..", "dashboard");

test("dashboard has a safe empty default with no operational game values", () => {
  const model = emptyModel();
  assert.equal(model.status, "awaiting");
  assert.equal(model.statusLabel, "Awaiting verified snapshots");
  assert.equal(model.pair, null);
  assert.deepEqual(model.comparison, { rows: [], counts: null });

  const html = fs.readFileSync(path.join(dashboardRoot, "index.html"), "utf8");
  assert.match(html, /Awaiting verified snapshots/);
  assert.match(html, /No game-state values are loaded/);
  assert.doesNotMatch(html, /example\.snapshot-pair\.json/);
});

test("dashboard escapes arbitrary HTML and renders imported values with textContent", () => {
  const attack = `<img src=x onerror="globalThis.compromised=true">&'`;
  assert.equal(
    escapeHtml(attack),
    "&lt;img src=x onerror=&quot;globalThis.compromised=true&quot;&gt;&amp;&#39;"
  );

  const comparison = compareStates({ label: attack }, { label: "<script>alert(1)</script>" });
  assert.equal(comparison.rows[0].status, "changed");
  assert.equal(comparison.rows[0].before, attack);

  const source = fs.readFileSync(path.join(dashboardRoot, "app.js"), "utf8");
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /element\.textContent = value/);
});

test("synthetic fixture is explicitly labeled and never treated as verified EU5 state", () => {
  const fixtureText = fs.readFileSync(
    path.join(dashboardRoot, "example.snapshot-pair.json"),
    "utf8"
  );
  const fixture = validatePair(JSON.parse(fixtureText));
  assert.equal(fixture.classification, "fixture-example");
  assert.match(fixture.displayLabel, /FIXTURE \/ EXAMPLE — NOT REAL EU5 STATE/);
  assert.equal(fixture.before.source.verification.status, "fixture");
  assert.equal(fixture.after.source.verification.status, "fixture");

  const model = buildModel(fixture);
  assert.equal(model.status, "fixture");
  assert.match(model.statusLabel, /not real EU5 state/i);
  assert.deepEqual(model.comparison.counts, {
    changed: 1,
    unchanged: 1,
    unknown: 1
  });
});

test("changed, unchanged, and missing or null fields are classified explicitly", () => {
  const result = compareStates(
    { economy: { changed: 1, same: "yes", nullBefore: null }, beforeOnly: true },
    { economy: { changed: 2, same: "yes", nullBefore: "known" }, afterOnly: true }
  );
  assert.deepEqual(result.counts, { changed: 1, unchanged: 1, unknown: 3 });
  assert.deepEqual(
    Object.fromEntries(result.rows.map((row) => [row.path, row.status])),
    {
      afterOnly: "unknown",
      beforeOnly: "unknown",
      "economy.changed": "changed",
      "economy.nullBefore": "unknown",
      "economy.same": "unchanged"
    }
  );
});

function makePair(classification, beforeStatus, afterStatus, overrides = {}) {
  const freshness = classification === "verified-snapshot-pair" ? "fresh" : "unknown";
  return {
    schemaVersion: "eu5.before-after-dashboard.pair/v1",
    classification,
    displayLabel: "Test pair",
    before: {
      schemaVersion: "eu5.before-after-dashboard.snapshot/v1",
      role: "before",
      snapshotId: "test-before",
      captureSessionId: "test-capture-session",
      entityId: "test-entity",
      adapter: { id: "test-adapter", version: "1.0.0-test" },
      rawContentSha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      fieldDefinitionFingerprint:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      capturedAt: "2026-01-01T00:00:00.000Z",
      gameTime: null,
      source: {
        label: "Test source",
        kind: "test",
        freshness,
        verification: { status: beforeStatus, evidence: "Test-only evidence" }
      },
      state: { test: "before" }
    },
    after: {
      schemaVersion: "eu5.before-after-dashboard.snapshot/v1",
      role: "after",
      snapshotId: "test-after",
      captureSessionId: "test-capture-session",
      entityId: "test-entity",
      adapter: { id: "test-adapter", version: "1.0.0-test" },
      rawContentSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      fieldDefinitionFingerprint:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      capturedAt: "2026-01-01T00:01:00.000Z",
      gameTime: null,
      source: {
        label: "Test source",
        kind: "test",
        freshness,
        verification: { status: afterStatus, evidence: "Test-only evidence" }
      },
      state: { test: "after" }
    },
    ...overrides
  };
}

test("pair classification cannot overstate or misrepresent snapshot provenance", () => {
  assert.throws(
    () => validatePair(makePair("verified-snapshot-pair", "verified", "unverified")),
    /requires both snapshots to be verified/
  );
  assert.throws(
    () => validatePair(makePair("fixture-example", "fixture", "unverified")),
    /must mark both snapshots as fixture/
  );
  assert.throws(
    () => validatePair(makePair("candidate-snapshot-pair", "fixture", "verified")),
    /cannot contain fixture snapshots/
  );

  const candidate = buildModel(makePair("candidate-snapshot-pair", "verified", "verified"));
  assert.equal(candidate.status, "unverified");
  assert.match(candidate.statusLabel, /not fully verified/i);

  const verified = buildModel(makePair("verified-snapshot-pair", "verified", "verified"));
  assert.equal(verified.status, "ready");
  assert.equal(verified.statusLabel, "Verified snapshots loaded");
});

test("verified promotion fails closed unless all provenance invariants match", async (t) => {
  const mismatchCases = [
    [
      "capture session",
      (pair) => {
        pair.after.captureSessionId = "different-session";
      },
      /captureSessionId must match/
    ],
    [
      "entity",
      (pair) => {
        pair.after.entityId = "different-entity";
      },
      /entityId must match/
    ],
    [
      "adapter id",
      (pair) => {
        pair.after.adapter.id = "different-adapter";
      },
      /adapter\.id must match/
    ],
    [
      "adapter version",
      (pair) => {
        pair.after.adapter.version = "2.0.0-test";
      },
      /adapter\.version must match/
    ],
    [
      "field definition fingerprint",
      (pair) => {
        pair.after.fieldDefinitionFingerprint =
          "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
      },
      /fieldDefinitionFingerprint must match/
    ]
  ];

  for (const [name, mutate, expected] of mismatchCases) {
    await t.test(`rejects mismatched ${name}`, () => {
      const pair = makePair("verified-snapshot-pair", "verified", "verified");
      mutate(pair);
      assert.throws(() => validatePair(pair), expected);
    });
  }

  await t.test("requires unique snapshot ids", () => {
    const pair = makePair("verified-snapshot-pair", "verified", "verified");
    pair.after.snapshotId = pair.before.snapshotId;
    assert.throws(() => validatePair(pair), /snapshotId.*must be unique/);
  });

  await t.test("requires both verified snapshots to be fresh", () => {
    const pair = makePair("verified-snapshot-pair", "verified", "verified");
    pair.before.source.freshness = "stale";
    assert.throws(() => validatePair(pair), /requires both snapshots to be fresh/);
  });

  await t.test("requires matching source kinds", () => {
    const pair = makePair("verified-snapshot-pair", "verified", "verified");
    pair.after.source.kind = "different-source-kind";
    assert.throws(() => validatePair(pair), /source\.kind to match/);
  });

  await t.test("accepts distinct valid raw capture hashes", () => {
    const pair = makePair("verified-snapshot-pair", "verified", "verified");
    assert.notEqual(pair.before.rawContentSha256, pair.after.rawContentSha256);
    assert.doesNotThrow(() => validatePair(pair));
    assert.equal(buildModel(pair).status, "ready");
  });

  await t.test("rejects an identical raw capture hash", () => {
    const pair = makePair("verified-snapshot-pair", "verified", "verified");
    pair.after.rawContentSha256 = pair.before.rawContentSha256;
    assert.throws(() => validatePair(pair), /distinct rawContentSha256/);
  });

  await t.test("requires both verified statuses", () => {
    assert.throws(
      () => validatePair(makePair("verified-snapshot-pair", "verified", "unverified")),
      /requires both snapshots to be verified/
    );
  });

  await t.test("requires every provenance field", () => {
    const pair = makePair("candidate-snapshot-pair", "unverified", "unverified");
    delete pair.before.captureSessionId;
    assert.throws(() => validatePair(pair), /before\.captureSessionId/);
  });

  await t.test("requires an adapter id and version", () => {
    const pair = makePair("candidate-snapshot-pair", "unverified", "unverified");
    delete pair.after.adapter.version;
    assert.throws(() => validatePair(pair), /after\.adapter\.version/);
  });

  await t.test("requires both content and field-definition hashes", () => {
    const missingRawHash = makePair(
      "candidate-snapshot-pair",
      "unverified",
      "unverified"
    );
    delete missingRawHash.before.rawContentSha256;
    assert.throws(() => validatePair(missingRawHash), /before\.rawContentSha256/);

    const missingFingerprint = makePair(
      "candidate-snapshot-pair",
      "unverified",
      "unverified"
    );
    delete missingFingerprint.after.fieldDefinitionFingerprint;
    assert.throws(
      () => validatePair(missingFingerprint),
      /after\.fieldDefinitionFingerprint/
    );
  });

  await t.test("rejects malformed, short, uppercase, and non-hex hashes", () => {
    const invalidHashes = [
      "a".repeat(63),
      "A".repeat(64),
      "g".repeat(64),
      `${"a".repeat(64)}00`
    ];
    for (const invalidHash of invalidHashes) {
      const rawHashPair = makePair("candidate-snapshot-pair", "unverified", "unverified");
      rawHashPair.before.rawContentSha256 = invalidHash;
      assert.throws(() => validatePair(rawHashPair), /64 lowercase hexadecimal/);

      const fingerprintPair = makePair(
        "candidate-snapshot-pair",
        "unverified",
        "unverified"
      );
      fingerprintPair.before.fieldDefinitionFingerprint = invalidHash;
      assert.throws(() => validatePair(fingerprintPair), /64 lowercase hexadecimal/);
    }
  });
});

test("candidate pairs remain non-ready even with fresh verified source claims", () => {
  const pair = makePair("candidate-snapshot-pair", "verified", "verified");
  pair.before.source.freshness = "fresh";
  pair.after.source.freshness = "fresh";
  const model = buildModel(pair);
  assert.equal(model.status, "unverified");
  assert.notEqual(model.statusLabel, "Verified snapshots loaded");
});

test("after capture time must be strictly later than before capture time", () => {
  const equalTime = makePair("candidate-snapshot-pair", "unverified", "unverified");
  equalTime.after.capturedAt = equalTime.before.capturedAt;
  assert.throws(() => validatePair(equalTime), /strictly later/);

  const reversedTime = makePair("candidate-snapshot-pair", "unverified", "unverified");
  reversedTime.after.capturedAt = "2025-12-31T23:59:59.999Z";
  assert.throws(() => validatePair(reversedTime), /strictly later/);

  assert.doesNotThrow(() =>
    validatePair(makePair("candidate-snapshot-pair", "unverified", "verified"))
  );
});

test("timestamps accept only canonical, calendar-valid UTC values", () => {
  assert.equal(
    parseCanonicalUtcTimestamp("2024-02-29T23:59:59Z", "timestamp"),
    Date.parse("2024-02-29T23:59:59Z")
  );
  assert.equal(
    parseCanonicalUtcTimestamp("2024-02-29T23:59:59.123Z", "timestamp"),
    Date.parse("2024-02-29T23:59:59.123Z")
  );

  const malformed = [
    "2026-01-01",
    "2026-01-01T00:00:00+00:00",
    "2026-01-01 00:00:00Z",
    "2026-1-01T00:00:00Z",
    "2026-01-01T00:00:00z",
    "2026-01-01T00:00:00.1Z",
    "2026-01-01T00:00:00.0000Z"
  ];
  for (const value of malformed) {
    assert.throws(
      () => parseCanonicalUtcTimestamp(value, "timestamp"),
      /canonical UTC form/
    );
  }

  const calendarInvalid = [
    "0000-01-01T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-00T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
    "2026-01-01T00:00:60Z"
  ];
  for (const value of calendarInvalid) {
    assert.throws(
      () => parseCanonicalUtcTimestamp(value, "timestamp"),
      /calendar-valid/
    );
  }

  const equalInstant = makePair("candidate-snapshot-pair", "unverified", "unverified");
  equalInstant.before.capturedAt = "2026-01-01T00:00:00Z";
  equalInstant.after.capturedAt = "2026-01-01T00:00:00.000Z";
  assert.throws(() => validatePair(equalInstant), /strictly later/);
});

test("state bounds reject dangerous structures without recursive traversal failure", () => {
  const tooDeep = {};
  let cursor = tooDeep;
  for (let depth = 0; depth <= LIMITS.MAX_STATE_DEPTH; depth += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assert.throws(
    () => validateStateBounds(tooDeep, "state"),
    /maximum nesting depth/
  );

  const tooManyFields = {};
  for (let index = 0; index <= LIMITS.MAX_FIELDS_PER_SNAPSHOT; index += 1) {
    tooManyFields[`field_${index}`] = index;
  }
  assert.throws(
    () => validateStateBounds(tooManyFields, "state"),
    /maximum field count/
  );

  const tooLongArray = {
    list: Array.from({ length: LIMITS.MAX_ARRAY_LENGTH + 1 }, (_, index) => index)
  };
  assert.throws(
    () => validateStateBounds(tooLongArray, "state"),
    /array exceeds maximum length/
  );

  const tooManyNestedArrayEntries = {
    matrix: Array.from({ length: 9 }, () =>
      Array.from({ length: LIMITS.MAX_ARRAY_LENGTH }, () => 0)
    )
  };
  assert.throws(
    () => validateStateBounds(tooManyNestedArrayEntries, "state"),
    /maximum field count/
  );

  assert.throws(
    () => validateStateBounds({ "ambiguous.path": true }, "state"),
    /cannot contain "\."/
  );
  assert.throws(
    () => validateStateBounds({ "": true }, "state"),
    /must be non-empty/
  );

  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => validateStateBounds(cyclic, "state"),
    /without circular or shared references/
  );
});

test("comparison rejects a union larger than the rendered-row bound", () => {
  const before = {};
  const after = {};
  const fieldsPerSide = Math.floor(LIMITS.MAX_RENDERED_ROWS / 2) + 1;
  for (let index = 0; index < fieldsPerSide; index += 1) {
    before[`before_${index}`] = index;
    after[`after_${index}`] = index;
  }
  assert.throws(
    () => compareStates(before, after),
    /maximum rendered rows/
  );
});

test("selected JSON files are bounded before and after reading", async () => {
  let oversizedRead = false;
  await assert.rejects(
    () =>
      readJsonFile({
        name: "oversized.json",
        size: LIMITS.MAX_FILE_BYTES + 1,
        text: async () => {
          oversizedRead = true;
          return "{}";
        }
      }),
    /exceeds maximum size/
  );
  assert.equal(oversizedRead, false);

  await assert.rejects(
    () =>
      readJsonFile({
        name: "misreported-size.json",
        size: 1,
        text: async () => `"${"x".repeat(LIMITS.MAX_FILE_BYTES)}"`
      }),
    /exceeds maximum size/
  );

  assert.deepEqual(
    await readJsonFile({
      name: "small.json",
      size: 2,
      text: async () => "{}"
    }),
    {}
  );
});
