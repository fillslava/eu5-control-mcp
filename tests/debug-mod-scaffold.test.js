"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MOD_ROOT = path.join(__dirname, "..", "mod", "eu5-control-debug");
const METADATA_PATH = path.join(MOD_ROOT, ".metadata", "metadata.json");
const SCRIPTED_GUI_PATH = path.join(MOD_ROOT, "in_game", "common", "scripted_guis", "eu5_control_debug.txt");
const PANEL_PATH = path.join(MOD_ROOT, "in_game", "gui", "eu5_control_debug.gui");
const LOCALIZATION_PATH = path.join(
  MOD_ROOT,
  "in_game",
  "localization",
  "english",
  "eu5_control_debug_l_english.yml"
);
const RUSSIAN_LOCALIZATION_PATH = path.join(
  MOD_ROOT,
  "in_game",
  "localization",
  "russian",
  "eu5_control_debug_l_russian.yml"
);
const MOD_VERSION = "0.5.0";
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
  assert.equal(
    fs.existsSync(path.join(MOD_ROOT, "in_game", "gui", "common_topbar.gui")),
    false,
    "an undocumented base-GUI shadow must not be admitted as an automatic opener"
  );
});

test("scripted GUI and supported localizations have the UTF-8 BOM required by the live lexer", () => {
  const bytes = fs.readFileSync(SCRIPTED_GUI_PATH);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  for (const localizationPath of [LOCALIZATION_PATH, RUSSIAN_LOCALIZATION_PATH]) {
    const localizationBytes = fs.readFileSync(localizationPath);
    assert.deepEqual([...localizationBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  }
  const english = stripBom(fs.readFileSync(LOCALIZATION_PATH, "utf8"));
  const russian = stripBom(fs.readFileSync(RUSSIAN_LOCALIZATION_PATH, "utf8"));
  assert.equal(
    russian.replace(/^l_russian:/, "l_english:"),
    english,
    "Russian-mode debug logging must expose the same reviewed telemetry templates"
  );
});

test("static debug panel exposes exactly eight fixed procedure buttons and one bounded init ping", () => {
  const panel = fs.readFileSync(PANEL_PATH, "utf8");
  assert.match(panel, /^\s*window\s*=\s*\{/);
  assert.match(panel, /name\s*=\s*"eu5_control_debug_window"/);
  assert.match(panel, /EU5 Control Debug v\d+\.\d+\.\d+ \(read-only\)/);
  assert.match(panel, /size\s*=\s*\{\s*440\s+540\s*\}/);
  assert.match(panel, /position\s*=\s*\{\s*20\s+220\s*\}/);
  assert.match(panel, /raw_text\s*=\s*"EU5 Control Debug/);
  assert.match(panel, /raw_text\s*=\s*"\[GetPlayer\.GetNameWithNoTooltip\] \| \[GetDateString\]"/);
  assert.match(panel, /visible\s*=\s*"\[IsGamePaused\]"/);
  assert.match(panel, /visible\s*=\s*"\[Not\(IsGamePaused\)\]"/);
  assert.match(panel, /TEST SESSION: disposable non-Ironman campaign only/);
  assert.match(panel, /Bridge health: loaded \| game paused/);
  assert.match(panel, /Last procedure\/result: external monitor is authoritative/);
  assert.match(panel, /name\s*=\s*bridge_init_ping/);
  assert.match(panel, /trigger_on_create\s*=\s*yes/);
  assert.match(panel, /duration\s*=\s*0\.1/);
  const init = /overlappingitembox\s*=\s*\{([\s\S]*?name\s*=\s*bridge_init_ping[\s\S]*?)\n\s{8}\}/.exec(panel);
  assert.ok(init, "missing bounded bridge_init widget");
  assert.equal([...init[1].matchAll(/\btrigger_on_create\s*=\s*yes/g)].length, 1);
  assert.equal([...init[1].matchAll(/\bon_finish\s*=/g)].length, 1);
  assert.match(
    init[1],
    /on_finish\s*=\s*"\[GetScriptedGui\('eu5_control_debug_emit_ping'\)\.Execute\(GuiScope\.SetRoot\(GetPlayer\.MakeScope\)\.End\)\]"/
  );
  assert.doesNotMatch(init[1], /\bnext\s*=/);
  assert.doesNotMatch(panel, /\bon_start\s*=/);
  assert.doesNotMatch(panel, /guiTypes|windowType|buttonType|textBoxType|width\s*=|height\s*=|moveable\s*=/);
  for (const procedure of PROCEDURES) {
    assert.match(panel, new RegExp("name\\s*=\\s*\\\"" + procedure + "\\\""));
    const guiScope = procedure === "emit_player_summary"
      ? "GuiScope\\.SetRoot\\(GetPlayer\\.MakeScope\\)" +
        "\\.AddScope\\('eu5_control_actor', GetPlayer\\.MakeScope\\)\\.End"
      : "GuiScope\\.SetRoot\\(GetPlayer\\.MakeScope\\)\\.End";
    assert.match(panel, new RegExp(
      "GetScriptedGui\\('eu5_control_debug_" + procedure +
      "'\\)\\.Execute\\(" + guiScope + "\\)"
    ));
  }
  assert.equal(
    [...panel.matchAll(/\.AddScope\(/g)].length,
    1,
    "only the nation-summary button may pass one reviewed named scope"
  );
  assert.match(
    panel,
    /\.AddScope\('eu5_control_actor', GetPlayer\.MakeScope\)/,
    "the fixed named scope must carry only the player country"
  );
  assert.equal(
    [...panel.matchAll(/\bGetScriptedGui\('/g)].length,
    PROCEDURES.length + 1,
    "panel may add only the one-shot emit_ping bridge handshake"
  );
  assert.equal(
    [...panel.matchAll(/eu5_control_debug_emit_ping'\)\.Execute/g)].length,
    2,
    "emit_ping must be reachable only from its button and the one-shot init handshake"
  );
  assert.doesNotMatch(panel, /textEntryType|ExecuteConsoleCommand|ExecuteConsoleCommands/i);
});

test("procedures use the vanilla minimal shape and emit only recognized structured records", () => {
  const script = stripBom(fs.readFileSync(SCRIPTED_GUI_PATH, "utf8")).replace(/#.*$/gm, "");
  const allowedLocalizationKeys = new Set([
    "EU5_CONTROL_NATION_COUNTRY_TAG",
    "EU5_CONTROL_NATION_GAME_DATE_DISPLAY",
    "EU5_CONTROL_ECONOMY_ESTIMATED_MONTHLY_INCOME_DISPLAY",
    "EU5_CONTROL_ECONOMY_ESTIMATED_TRADE_TAX_INCOME_DISPLAY",
    "EU5_CONTROL_ECONOMY_TREASURY_DISPLAY",
    "EU5_CONTROL_ECONOMY_MONTHLY_BALANCE_DISPLAY",
    "EU5_CONTROL_MARKETS_CAPITAL_MARKET_ID_DISPLAY",
    "EU5_CONTROL_MARKETS_CAPITAL_MARKET_NAME_DISPLAY",
    "EU5_CONTROL_MARKETS_CAPITAL_LOCATION_MARKET_ACCESS_DISPLAY",
    "EU5_CONTROL_MARKETS_MONTHLY_FOOD_BALANCE_DISPLAY",
    "EU5_CONTROL_MARKETS_FOOD_STOCKPILE_DISPLAY",
    "EU5_CONTROL_MARKETS_MAX_FOOD_STOCKPILE_DISPLAY",
    "EU5_CONTROL_MARKETS_FOOD_STOCKPILE_PERCENT_DISPLAY",
    "EU5_CONTROL_MARKETS_FOOD_PRICE_DISPLAY",
    "EU5_CONTROL_MARKETS_TOTAL_VALUE_TRADED_DISPLAY",
    "EU5_CONTROL_MILITARY_ARMY_SIZE_DISPLAY",
    "EU5_CONTROL_MILITARY_NAVY_SIZE_DISPLAY",
    "EU5_CONTROL_MILITARY_MANPOWER_DISPLAY"
  ]);
  for (const procedure of PROCEDURES) {
    const definition = new RegExp("eu5_control_debug_" + procedure + "\\s*=\\s*\\{([\\s\\S]*?)\\n\\}").exec(script);
    assert.ok(definition, "missing " + procedure + " definition");
    assert.doesNotMatch(definition[1], /\bscope\s*=/);
    assert.doesNotMatch(definition[1], /\bis_shown\s*=/);
    assert.doesNotMatch(definition[1], /\bis_valid\s*=/);
    if (procedure === "emit_player_summary") {
      assert.match(definition[1], /^\s*saved_scopes\s*=\s*\{\s*eu5_control_actor\s*\}\s*effect\s*=\s*\{/);
      assert.equal([...definition[1].matchAll(/\bscope:eu5_control_actor\s*=\s*\{/g)].length, 1);
    } else {
      assert.match(definition[1], /^\s*effect\s*=\s*\{/);
      assert.doesNotMatch(definition[1], /\bsaved_scopes\s*=/);
      assert.doesNotMatch(definition[1], /\bscope:[a-z0-9_]+\s*=/i);
    }
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
  assert.equal(
    [...script.matchAll(/\bsaved_scopes\s*=\s*\{\s*eu5_control_actor\s*\}/g)].length,
    1,
    "only nation summary may register the fixed player-country scope"
  );
  assert.equal(
    [...script.matchAll(/\bsaved_scopes\s*=/g)].length,
    1,
    "arbitrary saved-scope registrations are forbidden"
  );
  assert.equal(
    [...script.matchAll(/\bscope:eu5_control_actor\s*=\s*\{/g)].length,
    1,
    "the reviewed player-country scope may be entered only once"
  );
  const referencedLocalizationKeys = [
    ...script.matchAll(/\bdebug_log\s*=\s*(EU5_CONTROL_[A-Z0-9_]+)/g)
  ].map((match) => match[1]);
  assert.equal(referencedLocalizationKeys.length, allowedLocalizationKeys.size);
  assert.deepEqual(
    new Set(referencedLocalizationKeys),
    allowedLocalizationKeys,
    "only reviewed fixed localization-backed telemetry is allowed"
  );
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
  assert.match(readme, /all entries except nation summary contain only\s+`effect = \{ \.\.\. \}`/);
  assert.match(readme, /one fixed `saved_scopes = \{ eu5_control_actor \}` registration/);
  assert.match(readme, /hidden one-shot GUI animation runs `emit_ping`/);
  assert.match(readme, /eighteen fixed localization keys to expose real, read-only display strings/);
  assert.match(readme, /must never populate\s+typed metrics, trends, or `currentState`/);
  assert.match(readme, /passes only\s+fixed localization keys/);
  assert.match(readme, /external monitor is authoritative for the last\s+procedure and result/);
  assert.match(readme, /single exact\s+`GUI\.CreateWidget` invocation above remains the safest reviewed opener/);
  assert.match(readme, /generated GUI data types expose widget destruction\s+but no equivalent create\/attach function/);
  assert.match(readme, /does not ship a `common_topbar\.gui` override/);
  assert.match(readme, /fully restart EU5/);
  assert.match(readme, /Codex does not need a restart/);
  assert.match(readme, /does not claim automatic attachment/i);
  assert.match(readme, /does\s+not\s+grant\s+access\s+to\s+arbitrary\s+console\s+commands/i);
});
