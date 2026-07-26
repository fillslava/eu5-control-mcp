"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MOD_ROOT = path.join(__dirname, "..", "mod", "eu5-control-debug");
const METADATA_PATH = path.join(MOD_ROOT, ".metadata", "metadata.json");
const SCRIPTED_GUI_PATH = path.join(MOD_ROOT, "in_game", "common", "scripted_guis", "eu5_control_debug.txt");
const PANEL_PATH = path.join(MOD_ROOT, "in_game", "gui", "eu5_control_debug.gui");
const PROCEDURES = ["emit_ping", "emit_player_scope", "emit_state_snapshot"];

function stripBom(source) { return source.replace(/^\uFEFF/, ""); }

test("metadata has reviewed local-only identity and no replace paths", () => {
  const metadata = JSON.parse(fs.readFileSync(METADATA_PATH, "utf8"));
  assert.equal(metadata.name, "EU5 Control Debug");
  assert.equal(metadata.id, "eu5-control-debug");
  assert.match(metadata.version, /^\d+\.\d+\.\d+$/);
  assert.equal(metadata.supported_game_version, "1.3.*");
  assert.deepEqual(metadata.relationships, []);
  assert.deepEqual(metadata.game_custom_data.replace_paths, []);
});

test("scripted GUI source has the UTF-8 BOM required by the live lexer", () => {
  const bytes = fs.readFileSync(SCRIPTED_GUI_PATH);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("static debug panel exposes exactly three fixed procedure buttons", () => {
  const panel = fs.readFileSync(PANEL_PATH, "utf8");
  assert.match(panel, /name\s*=\s*"eu5_control_debug_window"/);
  assert.match(panel, /EU5 Control Debug \(read-only\)/);
  for (const procedure of PROCEDURES) {
    assert.match(panel, new RegExp("name\\s*=\\s*\\\"" + procedure + "\\\""));
    assert.match(panel, new RegExp("ScriptedGui\\.Execute\\('eu5_control_debug_" + procedure + "'\\)"));
  }
  assert.doesNotMatch(panel, /textEntryType|ExecuteConsoleCommand|ExecuteConsoleCommands/i);
});

test("procedures are country-scoped and emit only their fixed debug logs", () => {
  const script = stripBom(fs.readFileSync(SCRIPTED_GUI_PATH, "utf8")).replace(/#.*$/gm, "");
  for (const procedure of PROCEDURES) {
    const definition = new RegExp("eu5_control_debug_" + procedure + "\\s*=\\s*\\{([\\s\\S]*?)\\n\\}").exec(script);
    assert.ok(definition, "missing " + procedure + " definition");
    assert.match(definition[1], /\bscope\s*=\s*country\b/);
    assert.match(definition[1], /\bis_shown\s*=\s*\{\s*always\s*=\s*yes\s*\}/s);
    assert.match(definition[1], /\bis_valid\s*=\s*\{\s*always\s*=\s*yes\s*\}/s);
    assert.match(definition[1], new RegExp("\\beffect\\s*=\\s*\\{\\s*debug_log\\s*=\\s*\\\"EU5 Control Debug: " + procedure + "\\\"\\s*\\}", "s"));
  }
  for (const token of [
    /\bExecuteConsoleCommands?\b/i,
    /\b(add|remove|set|change|create|destroy|kill|start|end)_[a-z0-9_]+\b/i,
    /\b(gold|treasury|army|navy|unit|war|diplomacy|date|ai)\b/i
  ]) assert.doesNotMatch(script, token);
});

test("scaffold remains uninstalled and documents only the fixed opener", () => {
  const readme = fs.readFileSync(path.join(MOD_ROOT, "README.md"), "utf8");
  assert.match(readme, /workspace-only, debug-only mod scaffold/i);
  assert.match(readme, /not\s+installed,\s+copied,\s+linked,\s+or enabled/i);
  assert.match(readme, /GUI\.CreateWidget\(eu5_control_debug,eu5_control_debug_window\)/);
  assert.match(readme, /does\s+not\s+grant\s+access\s+to\s+arbitrary\s+console\s+commands/i);
});
