"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MOD_ROOT = path.join(__dirname, "..", "mod", "eu5-control-debug");
const METADATA_PATH = path.join(MOD_ROOT, ".metadata", "metadata.json");
const SCRIPTED_GUI_PATH = path.join(
  MOD_ROOT,
  "in_game",
  "common",
  "scripted_guis",
  "eu5_control_debug.txt"
);

test("debug mod metadata declares the required local scaffold identity", () => {
  const metadata = JSON.parse(fs.readFileSync(METADATA_PATH, "utf8"));

  assert.equal(metadata.name, "EU5 Control Debug");
  assert.equal(metadata.id, "eu5-control-debug");
  assert.match(metadata.version, /^\d+\.\d+\.\d+$/);
  assert.equal(metadata.supported_game_version, "1.3.*");
  assert.equal(typeof metadata.short_description, "string");
  assert.ok(metadata.short_description.length > 0);
  assert.deepEqual(metadata.relationships, []);
  assert.deepEqual(metadata.game_custom_data.replace_paths, []);
});

test("debug scripted GUI is visible, valid, country-scoped, and effect-free", () => {
  const source = fs.readFileSync(SCRIPTED_GUI_PATH, "utf8");
  const script = source.replace(/#.*$/gm, "");

  assert.match(script, /^\s*eu5_control_debug_diagnostic\s*=\s*\{/);
  assert.match(script, /\bscope\s*=\s*country\b/);
  assert.match(script, /\bis_shown\s*=\s*\{\s*always\s*=\s*yes\s*\}/s);
  assert.match(script, /\bis_valid\s*=\s*\{\s*always\s*=\s*yes\s*\}/s);
  assert.match(script, /\beffect\s*=\s*\{\s*\}/s);

  const unsafeTokens = [
    /\bexecute_?console_?commands?\b/i,
    /\b(add|remove|set|change|create|destroy|kill|start|end)_[a-z0-9_]+\b/i,
    /\b(gold|treasury|army|navy|unit|war|diplomacy|date|ai)\b/i
  ];

  for (const token of unsafeTokens) {
    assert.doesNotMatch(script, token);
  }
});

test("debug scaffold remains unattached and explicitly uninstalled", () => {
  const readme = fs.readFileSync(path.join(MOD_ROOT, "README.md"), "utf8");

  assert.match(readme, /workspace-only, debug-only mod scaffold/i);
  assert.match(readme, /not\s+installed, copied, linked, or enabled/i);
  assert.match(readme, /There is no GUI layout or scripted-widget mapping/i);
  assert.equal(fs.existsSync(path.join(MOD_ROOT, "in_game", "gui")), false);
});
