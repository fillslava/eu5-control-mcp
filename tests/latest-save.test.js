"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { latestSaveCheckpoint } = require("../src/read/latest-save");

test("fast checkpoint observation selects the newest save without hashing", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-latest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const older = path.join(root, "older.eu5");
  const newest = path.join(root, "newest.eu5");
  fs.writeFileSync(older, "old");
  fs.writeFileSync(newest, "new");
  fs.utimesSync(older, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
  fs.utimesSync(newest, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));

  const result = latestSaveCheckpoint(root);
  assert.equal(result.fileCount, 2);
  assert.equal(result.latest.relativePath, "newest.eu5");
  assert.equal(result.latest.bytes, 3);
});
