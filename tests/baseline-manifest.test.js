"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildBaseline } = require("../scripts/euv-baseline-manifest");
const { verifyBaseline } = require("../scripts/verify-euv-baseline");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "euv-baseline-"));
  const saves = path.join(root, "disposable-save");
  const mod = path.join(root, "debug-mod");
  fs.mkdirSync(saves);
  fs.mkdirSync(path.join(mod, ".metadata"), { recursive: true });
  fs.writeFileSync(path.join(saves, "campaign.eu5"), "opaque save bytes");
  fs.writeFileSync(path.join(saves, "ignore.txt"), "not a save");
  fs.writeFileSync(path.join(mod, ".metadata", "metadata.json"), JSON.stringify({ id: "debug-id", version: "1.0.0", supported_game_version: "1.3.*" }));
  fs.writeFileSync(path.join(mod, "readme.txt"), "mod source");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { saves, mod };
}

function inputs(fixture) {
  return { saveDirectory: fixture.saves, confirmedSaveDirectory: fixture.saves, modDirectory: fixture.mod, confirmedModDirectory: fixture.mod, buildMarker: "node --check src/server.js", testMarker: "node --test" };
}

test("baseline inventories opaque disposable saves and mod artifacts without local paths", (t) => {
  const value = fixture(t);
  const baseline = buildBaseline(inputs(value));
  assert.equal(baseline.readOnly, true);
  assert.equal(baseline.saveParsing, "not-performed");
  assert.deepEqual(baseline.saveInventory.files.map((file) => file.relativePath), ["campaign.eu5"]);
  assert.equal(baseline.modManifest.identity.id, "debug-id");
  assert.doesNotMatch(JSON.stringify(baseline), new RegExp(value.saves.replace(/\\/g, "\\\\"), "i"));
  assert.doesNotMatch(JSON.stringify(baseline), new RegExp(value.mod.replace(/\\/g, "\\\\"), "i"));
});

test("baseline requires exact confirmed roots and ignores linked entries", (t) => {
  const value = fixture(t);
  assert.throws(() => buildBaseline({ ...inputs(value), confirmedSaveDirectory: value.mod }), /must match/);
  const link = path.join(value.saves, "linked.eu5");
  try { fs.symlinkSync(path.join(value.saves, "campaign.eu5"), link, "file"); } catch (error) { if (error.code === "EPERM") return; throw error; }
  const baseline = buildBaseline(inputs(value));
  assert.equal(baseline.saveInventory.fileCount, 1);
});

test("verification checks marker inputs, manifest identity, and artifact hashes", (t) => {
  const value = fixture(t);
  const baseline = buildBaseline(inputs(value));
  assert.deepEqual(verifyBaseline(baseline, inputs(value)), { verified: true, readOnly: true, failures: [] });
  assert.equal(verifyBaseline(baseline, { ...inputs(value), testMarker: "node --test tests/baseline-manifest.test.js" }).failures[0], "test marker differs");
  fs.writeFileSync(path.join(value.mod, "readme.txt"), "changed source");
  assert.ok(verifyBaseline(baseline, inputs(value)).failures.includes("mod inventory differs"));
});
