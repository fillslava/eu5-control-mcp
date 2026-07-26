"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MOD_ROOT = path.join(__dirname, "..", "mod", "eu5-control-debug");
const SCRIPTED_GUI_PATH = path.join(
  MOD_ROOT,
  "in_game",
  "common",
  "scripted_guis",
  "eu5_control_debug.txt"
);

const EXPECTED = {
  emit_player_summary: {
    recordType: "player_summary",
    section: "nation",
    available: ["atWar", "isSubject"],
    unavailable: ["countryName", "gameDate"]
  },
  emit_economy_snapshot: {
    recordType: "economy_snapshot",
    section: "economy",
    available: ["monthlyBalanceClass", "treasuryClass"],
    unavailable: ["monthlyBalance", "treasury", "monthlyIncomeTotal"]
  },
  emit_markets_snapshot: {
    recordType: "markets_snapshot",
    section: "markets",
    available: ["hasMarketCenters"],
    unavailable: ["marketCount", "foodStockpile", "shortages"]
  },
  emit_diplomacy_snapshot: {
    recordType: "diplomacy_snapshot",
    section: "diplomacy",
    available: ["atWar", "isSubject"],
    unavailable: ["relations", "allies"]
  },
  emit_military_snapshot: {
    recordType: "military_snapshot",
    section: "military",
    available: ["hasArmy", "hasNavy", "canRaiseArmyLevies"],
    unavailable: ["manpower", "supplyStatus"]
  }
};

function source() {
  return fs.readFileSync(SCRIPTED_GUI_PATH, "utf8").replace(/^\uFEFF/, "");
}

function procedureBody(script, procedure) {
  const match = new RegExp(
    "eu5_control_debug_" + procedure + "\\s*=\\s*\\{([\\s\\S]*?)\\n\\}"
  ).exec(script);
  assert.ok(match, "missing procedure " + procedure);
  return match[1];
}

function records(body) {
  return [...body.matchAll(/\bdebug_log\s*=\s*"((?:\\"|[^"])*)"/gs)].map((match) => {
    const line = match[1].replace(/\\"/g, '"');
    assert.match(line, /^EU5_CONTROL \{/);
    return JSON.parse(line.slice("EU5_CONTROL ".length));
  });
}

test("telemetry exporters declare their partial envelope and typed field coverage", () => {
  const script = source();
  for (const [procedure, expected] of Object.entries(EXPECTED)) {
    const emitted = records(procedureBody(script, procedure));
    const envelope = emitted.find((record) => record.recordType === expected.recordType);
    assert.deepEqual(
      {
        procedure: envelope?.procedure,
        section: envelope?.section,
        status: envelope?.status,
        completeness: envelope?.completeness,
        observationJoinRequired: envelope?.observationJoinRequired,
        modVersion: envelope?.modVersion
      },
      {
        procedure,
        section: expected.section,
        status: "acknowledged",
        completeness: "partial",
        observationJoinRequired: true,
        modVersion: "0.3.0"
      }
    );

    const facts = emitted.filter((record) => record.recordType === "telemetry_fact");
    for (const field of expected.available) {
      const variants = facts.filter(
        (record) => record.field === field && record.availability === "available"
      );
      assert.ok(variants.length >= 2,
        `${procedure}.${field} must have explicit observed variants`);
      assert.ok(variants.every((record) => record.value !== null));
      assert.ok(variants.every((record) => record.status === "observed"));
      assert.ok(variants.every((record) => record.modVersion === "0.3.0"));
    }
    for (const field of expected.unavailable) {
      const unavailable = facts.find((record) => record.field === field);
      assert.ok(unavailable, `missing unavailable marker ${procedure}.${field}`);
      assert.equal(unavailable.availability, "unavailable");
      assert.equal(unavailable.value, null);
      assert.equal(unavailable.status, "observed");
      assert.equal(unavailable.modVersion, "0.3.0");
      assert.match(unavailable.reason, /^(?:no_json_safe_|requires_|use_)/);
    }
  }
});

test("telemetry effects use only reviewed read-only control flow and triggers", () => {
  const script = source();
  const withoutLogs = script.replace(/\bdebug_log\s*=\s*"((?:\\"|[^"])*)"/gs, "");
  const tokens = [...withoutLogs.matchAll(/\b([a-z][a-z0-9_]*)\b(?=\s*(?:=|<|>))/g)]
    .map((match) => match[1]);
  const allowed = new Set([
    "eu5_control_debug_emit_ping",
    "eu5_control_debug_emit_player_scope",
    "eu5_control_debug_emit_state_snapshot",
    ...Object.keys(EXPECTED).map((name) => "eu5_control_debug_" + name),
    "effect",
    "if",
    "else",
    "limit",
    "at_war",
    "is_subject",
    "monthly_balance",
    "gold",
    "has_markets",
    "army_size",
    "navy_size",
    "can_raise_army_levies"
  ]);
  assert.deepEqual([...new Set(tokens.filter((token) => !allowed.has(token)))], []);
  assert.doesNotMatch(script, /ExecuteConsole|textEntry|save_game|load_game|execute_effect/i);
});
