"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildLiveFeed } = require("../src/monitoring/live-feed");

const MOD_ROOT = path.join(__dirname, "..", "mod", "eu5-control-debug");
const SCRIPTED_GUI_PATH = path.join(
  MOD_ROOT,
  "in_game",
  "common",
  "scripted_guis",
  "eu5_control_debug.txt"
);
const LOCALIZATION_PATH = path.join(
  MOD_ROOT,
  "in_game",
  "localization",
  "english",
  "eu5_control_debug_l_english.yml"
);
const EXPECTED_LOCALIZATION_VALUES = Object.freeze({
  EU5_CONTROL_NATION_COUNTRY_TAG: "[ROOT.GetCountry.GetTag]",
  EU5_CONTROL_NATION_GAME_DATE_DISPLAY: "[GetDateString]",
  EU5_CONTROL_ECONOMY_ESTIMATED_MONTHLY_INCOME_DISPLAY:
    "[ROOT.GetCountry.GetEstimatedMonthlyIncome|2]",
  EU5_CONTROL_ECONOMY_ESTIMATED_TRADE_TAX_INCOME_DISPLAY:
    "[ROOT.GetCountry.GetEstimatedMonthlyIncomeTradeAndTax|2]",
  EU5_CONTROL_ECONOMY_TREASURY_DISPLAY:
    "[ROOT.GetCountry.GetFixedPointCurrencyValue('gold')|2]",
  EU5_CONTROL_ECONOMY_MONTHLY_BALANCE_DISPLAY:
    "[ROOT.GetCountry.GetCurrencyBalance('gold')|2]",
  EU5_CONTROL_MILITARY_ARMY_SIZE_DISPLAY: "[ROOT.GetCountry.GetArmySize]",
  EU5_CONTROL_MILITARY_NAVY_SIZE_DISPLAY: "[ROOT.GetCountry.GetNavySize]",
  EU5_CONTROL_MILITARY_MANPOWER_DISPLAY:
    "[ROOT.GetCountry.GetCurrencyValue('manpower')]"
});

const EXPECTED = {
  emit_player_summary: {
    recordType: "player_summary",
    section: "nation",
    available: ["atWar", "isSubject"],
    display: ["countryTag", "gameDateDisplay"],
    unavailable: ["countryName", "gameDate"]
  },
  emit_economy_snapshot: {
    recordType: "economy_snapshot",
    section: "economy",
    available: ["monthlyBalanceClass", "treasuryClass"],
    display: [
      "estimatedMonthlyIncomeDisplay",
      "estimatedTradeTaxIncomeDisplay",
      "treasuryDisplay",
      "monthlyBalanceDisplay"
    ],
    unavailable: ["monthlyBalance", "treasury", "monthlyIncomeTotal"]
  },
  emit_markets_snapshot: {
    recordType: "markets_snapshot",
    section: "markets",
    available: ["hasMarketCenters"],
    display: [],
    unavailable: ["marketCount", "foodStockpile", "shortages"]
  },
  emit_diplomacy_snapshot: {
    recordType: "diplomacy_snapshot",
    section: "diplomacy",
    available: ["atWar", "isSubject"],
    display: [],
    unavailable: ["relations", "allies"]
  },
  emit_military_snapshot: {
    recordType: "military_snapshot",
    section: "military",
    available: ["hasArmy", "hasNavy", "canRaiseArmyLevies"],
    display: ["armySizeDisplay", "navySizeDisplay", "manpowerDisplay"],
    unavailable: ["manpower", "supplyStatus"]
  }
};

function source() {
  return fs.readFileSync(SCRIPTED_GUI_PATH, "utf8").replace(/^\uFEFF/, "");
}

function localizationRecords() {
  const localized = fs.readFileSync(LOCALIZATION_PATH, "utf8").replace(/^\uFEFF/, "");
  const entries = new Map();
  for (const match of localized.matchAll(
    /^\s*(EU5_CONTROL_[A-Z0-9_]+):\s*"((?:\\"|[^"])*)"\s*$/gm
  )) {
    const line = match[2].replace(/\\"/g, '"');
    assert.match(line, /^EU5_CONTROL \{/);
    entries.set(match[1], JSON.parse(line.slice("EU5_CONTROL ".length)));
  }
  return entries;
}

function procedureBody(script, procedure) {
  const match = new RegExp(
    "eu5_control_debug_" + procedure + "\\s*=\\s*\\{([\\s\\S]*?)\\n\\}"
  ).exec(script);
  assert.ok(match, "missing procedure " + procedure);
  return match[1];
}

function records(body, localized = localizationRecords()) {
  const literalRecords = [...body.matchAll(
    /\bdebug_log\s*=\s*"((?:\\"|[^"])*)"/gs
  )].map((match) => {
    const line = match[1].replace(/\\"/g, '"');
    assert.match(line, /^EU5_CONTROL \{/);
    return JSON.parse(line.slice("EU5_CONTROL ".length));
  });
  const localizedRecords = [...body.matchAll(
    /\bdebug_log\s*=\s*(EU5_CONTROL_[A-Z0-9_]+)/g
  )].map((match) => {
    const record = localized.get(match[1]);
    assert.ok(record, `missing localization template ${match[1]}`);
    return record;
  });
  return [...literalRecords, ...localizedRecords];
}

test("telemetry exporters declare their partial envelope and typed field coverage", () => {
  const script = source();
  const localized = localizationRecords();
  for (const [procedure, expected] of Object.entries(EXPECTED)) {
    const emitted = records(procedureBody(script, procedure), localized);
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
        modVersion: "0.4.0"
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
      assert.ok(variants.every((record) => record.modVersion === "0.4.0"));
    }
    for (const field of expected.unavailable) {
      const unavailable = facts.find((record) => record.field === field);
      assert.ok(unavailable, `missing unavailable marker ${procedure}.${field}`);
      assert.equal(unavailable.availability, "unavailable");
      assert.equal(unavailable.value, null);
      assert.equal(unavailable.status, "observed");
      assert.equal(unavailable.modVersion, "0.4.0");
      assert.match(unavailable.reason, /^(?:no_json_safe_|requires_|use_)/);
    }
    for (const field of expected.display) {
      const display = facts.filter(
        (record) => record.field === field && record.availability === "available"
      );
      assert.equal(display.length, 1, `${procedure}.${field} must have one live template`);
      assert.equal(typeof display[0].value, "string");
      assert.match(display[0].value, /^\[(?:ROOT\.GetCountry\.Get|GetDateString)/);
      assert.equal(display[0].status, "observed");
      assert.equal(display[0].modVersion, "0.4.0");
      assert.equal(Object.hasOwn(display[0], "unit"), false);
      assert.equal(Object.hasOwn(display[0], "reason"), false);
    }
  }
});

test("localization producers are fixed read-only templates with documented getters", () => {
  const localized = localizationRecords();
  assert.deepEqual(
    [...localized.keys()].sort(),
    Object.keys(EXPECTED_LOCALIZATION_VALUES).sort()
  );
  for (const [key, expectedValue] of Object.entries(EXPECTED_LOCALIZATION_VALUES)) {
    assert.equal(localized.get(key).value, expectedValue, `${key} getter drift`);
  }
  const values = [...localized.values()];
  assert.ok(values.every((record) => record.schemaVersion === "eu5.control-log/v1"));
  assert.ok(values.every((record) => record.recordType === "telemetry_fact"));
  assert.ok(values.every((record) => record.availability === "available"));
  assert.ok(values.every((record) => record.modVersion === "0.4.0"));
  assert.ok(values.every((record) => typeof record.value === "string"));
  assert.doesNotMatch(
    fs.readFileSync(LOCALIZATION_PATH, "utf8"),
    /ExecuteConsole|execute_effect|save_game|load_game|textEntry/i
  );
});

test("literal mod templates flow only into unverified partial live observations", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-real-mod-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const substitutions = new Map([
    ["[ROOT.GetCountry.GetTag]", "HOL"],
    ["[GetDateString]", "12 May 1337"],
    ["[ROOT.GetCountry.GetEstimatedMonthlyIncome|2]", "63.80"],
    ["[ROOT.GetCountry.GetEstimatedMonthlyIncomeTradeAndTax|2]", "42.10"],
    ["[ROOT.GetCountry.GetFixedPointCurrencyValue('gold')|2]", "109.42"],
    ["[ROOT.GetCountry.GetCurrencyBalance('gold')|2]", "2.14"],
    ["[ROOT.GetCountry.GetArmySize]", "0"],
    ["[ROOT.GetCountry.GetNavySize]", "3"],
    ["[ROOT.GetCountry.GetCurrencyValue('manpower')]", "12.4K"]
  ]);
  const script = source();
  const emitted = [];
  for (const [procedure, expected] of Object.entries(EXPECTED)) {
    const candidates = records(procedureBody(script, procedure));
    const header = candidates.find(
      (record) => record.recordType === expected.recordType
    );
    assert.ok(header, `missing real header for ${procedure}`);
    emitted.push(header);
    const seenFields = new Set();
    for (const candidate of candidates) {
      if (
        candidate.recordType !== "telemetry_fact" ||
        seenFields.has(candidate.field)
      ) continue;
      seenFields.add(candidate.field);
      emitted.push({
        ...candidate,
        value: substitutions.get(candidate.value) ?? candidate.value
      });
    }
  }
  const logPath = path.join(root, "debug.log");
  const nowMs = Date.now();
  const observedAt = new Date(nowMs);
  const clockPrefix = [
    observedAt.getUTCHours(),
    observedAt.getUTCMinutes()
  ].map((part) => String(part).padStart(2, "0")).join(":");
  fs.writeFileSync(
    logPath,
    emitted.map((record, index) =>
      `[${clockPrefix}:${String(index % 60).padStart(2, "0")}][jomini_effect_impl.cpp:479]: ` +
      `common/scripted_guis/eu5_control_debug.txt:${index + 1}: ` +
      `EU5_CONTROL ${JSON.stringify(record)}`
    ).join("\n")
  );
  fs.utimesSync(logPath, new Date(nowMs), new Date(nowMs));
  const feed = buildLiveFeed({
    logPath,
    now: () => nowMs,
    ledgerReader: () => [],
    saveDirectory: path.join(root, "missing-saves")
  });

  assert.equal(feed.currentState.status, "unavailable");
  assert.equal(feed.currentObservations.status, "partial");
  assert.deepEqual(
    Object.keys(feed.currentObservations.domains).sort(),
    ["diplomacy", "economy", "markets", "military", "nation"]
  );
  assert.equal(
    feed.currentObservations.domains.nation.fields.countryTag.value,
    "HOL"
  );
  assert.equal(
    feed.currentObservations.domains.economy.fields
      .estimatedMonthlyIncomeDisplay.value,
    "63.80"
  );
  assert.equal(
    feed.currentObservations.domains.economy.fields.treasuryDisplay.value,
    "109.42"
  );
  assert.equal(
    feed.currentObservations.domains.economy.fields.monthlyBalanceDisplay.value,
    "2.14"
  );
  assert.equal(
    feed.currentObservations.domains.military.fields.armySizeDisplay.value,
    "0"
  );
  const bridgeRecords = feed.records.filter(
    (record) => record.provenance?.adapter?.id === "eu5-control-bridge"
  );
  assert.ok(bridgeRecords.length > 0);
  assert.ok(bridgeRecords.every((record) =>
    record.recordType === "game_event" &&
    record.provenance.verification.status === "unverified"
  ));
  assert.equal(
    bridgeRecords.some((record) => record.recordType === "nation_snapshot"),
    false
  );
  const health = feed.records.find(
    (record) =>
      record.recordType === "health" &&
      record.payload.component === "structured-debug-log"
  );
  assert.equal(health.payload.status, "partial-observation-only");
  assert.equal(health.payload.verifiedTypedRecordCount, 0);
});

test("telemetry effects use only reviewed read-only control flow and triggers", () => {
  const script = source();
  const withoutLogs = script
    .replace(/\bdebug_log\s*=\s*"((?:\\"|[^"])*)"/gs, "")
    .replace(/\bdebug_log\s*=\s*EU5_CONTROL_[A-Z0-9_]+/g, "");
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
