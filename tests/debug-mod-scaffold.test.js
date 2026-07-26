"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MOD_ROOT = path.join(__dirname, "..", "mod", "eu5-control-debug");
const METADATA_PATH = path.join(MOD_ROOT, ".metadata", "metadata.json");
const SCRIPTED_GUI_PATH = path.join(MOD_ROOT, "in_game", "common", "scripted_guis", "eu5_control_debug.txt");
const PANEL_PATH = path.join(MOD_ROOT, "in_game", "gui", "eu5_control_debug.gui");
const MOD_VERSION = "0.3.0";
const PROCEDURES = [
  "emit_ping",
  "emit_player_scope",
  "emit_state_snapshot",
  "emit_player_summary",
  "emit_economy_snapshot",
  "emit_markets_snapshot",
  "emit_diplomacy_snapshot",
  "emit_military_snapshot"
];

function stripBom(source) { return source.replace(/^\uFEFF/, ""); }

test("metadata has reviewed local-only identity and no replace paths", () => {
  const metadata = JSON.parse(fs.readFileSync(METADATA_PATH, "utf8"));
  assert.equal(metadata.name, "EU5 Control Debug");
  assert.equal(metadata.id, "eu5-control-debug");
  assert.equal(metadata.version, MOD_VERSION);
  assert.equal(metadata.supported_game_version, "1.3.*");
  assert.deepEqual(metadata.relationships, []);
  assert.deepEqual(metadata.game_custom_data.replace_paths, []);
});

test("scripted GUI source has the UTF-8 BOM required by the live lexer", () => {
  const bytes = fs.readFileSync(SCRIPTED_GUI_PATH);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("static debug panel exposes exactly eight fixed procedure buttons", () => {
  const panel = fs.readFileSync(PANEL_PATH, "utf8");
  assert.match(panel, /^\s*window\s*=\s*\{/);
  assert.match(panel, /name\s*=\s*"eu5_control_debug_window"/);
  assert.match(panel, /EU5 Control Debug v\d+\.\d+\.\d+ \(read-only\)/);
  assert.match(panel, /size\s*=\s*\{\s*420\s+416\s*\}/);
  assert.match(panel, /position\s*=\s*\{\s*20\s+220\s*\}/);
  assert.match(panel, /raw_text\s*=\s*"EU5 Control Debug/);
  assert.match(panel, /raw_text\s*=\s*"\[GetPlayer\.GetNameWithNoTooltip\] \| \[GetDateString\]"/);
  assert.match(panel, /visible\s*=\s*"\[IsGamePaused\]"/);
  assert.match(panel, /visible\s*=\s*"\[Not\(IsGamePaused\)\]"/);
  assert.doesNotMatch(panel, /\bon_start\s*=/);
  assert.doesNotMatch(panel, /guiTypes|windowType|buttonType|textBoxType|width\s*=|height\s*=|moveable\s*=/);
  for (const procedure of PROCEDURES) {
    assert.match(panel, new RegExp("name\\s*=\\s*\\\"" + procedure + "\\\""));
    assert.match(panel, new RegExp(
      "GetScriptedGui\\('eu5_control_debug_" + procedure +
      "'\\)\\.Execute\\(GuiScope\\.SetRoot\\(GetPlayer\\.MakeScope\\)\\.End\\)"
    ));
  }
  assert.equal(
    [...panel.matchAll(/\bGetScriptedGui\('/g)].length,
    PROCEDURES.length,
    "panel must not expose undeclared scripted-GUI routes"
  );
  assert.doesNotMatch(panel, /textEntryType|ExecuteConsoleCommand|ExecuteConsoleCommands/i);
});

test("procedures use the vanilla minimal shape and emit only recognized structured records", () => {
  const script = stripBom(fs.readFileSync(SCRIPTED_GUI_PATH, "utf8")).replace(/#.*$/gm, "");
  for (const procedure of PROCEDURES) {
    const definition = new RegExp("eu5_control_debug_" + procedure + "\\s*=\\s*\\{([\\s\\S]*?)\\n\\}").exec(script);
    assert.ok(definition, "missing " + procedure + " definition");
    assert.doesNotMatch(definition[1], /\bscope\s*=/);
    assert.doesNotMatch(definition[1], /\bis_shown\s*=/);
    assert.doesNotMatch(definition[1], /\bis_valid\s*=/);
    assert.match(definition[1], /^\s*effect\s*=\s*\{/);
    const logMatches = [...definition[1].matchAll(/\bdebug_log\s*=\s*"((?:\\"|[^"])*)"/gs)];
    assert.ok(logMatches.length > 0, "missing structured debug_log for " + procedure);
    for (const logMatch of logMatches) {
      const line = logMatch[1].replace(/\\"/g, '"');
      assert.match(line, /^EU5_CONTROL \{/);
      const record = JSON.parse(line.slice("EU5_CONTROL ".length));
      assert.equal(record.schemaVersion, "eu5.control-log/v1");
      assert.equal(record.procedure, procedure);
      assert.equal(record.modVersion, MOD_VERSION);
      assert.ok(["acknowledged", "observed"].includes(record.status));
      assert.equal(Object.hasOwn(record, "countryName"), false);
      assert.equal(Object.hasOwn(record, "gameDate"), false);
      assert.equal(Object.hasOwn(record, "paused"), false);
      assert.doesNotMatch(line, /\[(?:ROOT|GetDateString)/);
    }
  }
  for (const token of [
    /\bExecuteConsoleCommands?\b/i,
    /\b(add|remove|set|change|create|destroy|kill|start|end)_[a-z0-9_]+\b/i,
    /\bdeclare_war\b/i,
    /\bexecute_effect\b/i,
    /\bsave_(?:game|scope|temporary_scope|scope_value)\b/i
  ]) assert.doesNotMatch(script, token);
});

test("scaffold documents bounded debug installation and only the fixed opener", () => {
  const readme = fs.readFileSync(path.join(MOD_ROOT, "README.md"), "utf8");
  assert.match(readme, /debug-only mod scaffold/i);
  assert.match(readme, /current test workstation has a reviewed copy installed/i);
  assert.match(readme, /never target a normal campaign playset/i);
  assert.match(readme, /GUI\.CreateWidget gui\/eu5_control_debug\.gui eu5_control_debug_window/);
  assert.match(readme, /Alt\+C/);
  assert.match(readme, /EU5_CONTROL/);
  assert.match(readme, /eu5\.control-log\/v1/);
  assert.match(readme, /observationJoinRequired/);
  assert.match(readme, /pdx_data_localize Data error/);
  assert.match(readme, /does not handle the `on_start` callback/);
  assert.match(readme, /contains only `effect = \{ \.\.\. \}`/);
  assert.match(readme, /fully restart EU5/);
  assert.match(readme, /Codex does not need a restart/);
  assert.match(readme, /does not claim automatic attachment/i);
  assert.match(readme, /does\s+not\s+grant\s+access\s+to\s+arbitrary\s+console\s+commands/i);
});
