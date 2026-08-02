"use strict";

const TYPED_RECORD_DEFINITIONS = Object.freeze({
  player_summary: Object.freeze({
    procedure: "emit_player_summary",
    domain: "player",
    metrics: Object.freeze({
      population: "persons",
      stability: "points",
      prestige: "points",
      legitimacy: "percent",
      averageControl: "percent",
      literacy: "percent"
    })
  }),
  economy_snapshot: Object.freeze({
    procedure: "emit_economy_snapshot",
    domain: "economy",
    metrics: Object.freeze({
      treasury: "ducats",
      monthlyIncome: "ducats_per_month",
      monthlyExpenses: "ducats_per_month",
      monthlyBalance: "ducats_per_month",
      debt: "ducats",
      inflation: "percent",
      tradeBalance: "ducats_per_month",
      loanCount: "count",
      bankrupt: "boolean"
    })
  }),
  markets_snapshot: Object.freeze({
    procedure: "emit_markets_snapshot",
    domain: "markets",
    metrics: Object.freeze({
      foodBalance: "units_per_month",
      tradeIncome: "ducats_per_month",
      marketAccess: "percent",
      prosperity: "points"
    })
  }),
  diplomacy_snapshot: Object.freeze({
    procedure: "emit_diplomacy_snapshot",
    domain: "diplomacy",
    metrics: Object.freeze({
      diplomaticCapacity: "points",
      diplomaticUsage: "points",
      aggressiveExpansion: "points",
      diplomatCount: "count",
      warCount: "count",
      subjectCount: "count",
      atWar: "boolean"
    })
  }),
  military_snapshot: Object.freeze({
    procedure: "emit_military_snapshot",
    domain: "military",
    metrics: Object.freeze({
      manpower: "persons",
      manpowerRecovery: "persons_per_month",
      armyStrength: "soldiers",
      navyStrength: "ships",
      militaryMaintenance: "ducats_per_month",
      armyPower: "points",
      navyPower: "points",
      navySize: "ships"
    })
  })
});

const TYPED_RECORD_TYPES = new Set(Object.keys(TYPED_RECORD_DEFINITIONS));
const COMMON_PAYLOAD_KEYS = new Set([
  "country",
  "gameDate",
  "capturedAtUtc",
  "paused",
  "gameBuild",
  "metrics",
  "market",
  "goods",
  "relations",
  "armies"
]);
const COUNTRY_KEYS = new Set(["id", "tag", "name"]);
const METRIC_KEYS = new Set(["value", "unit"]);
const MARKET_KEYS = new Set(["id", "name"]);
const GOOD_KEYS = new Set(["id", "name", "price", "balance", "stockpile"]);
const RELATION_KEYS = new Set([
  "country",
  "opinion",
  "relation",
  "atWar",
  "truceUntil"
]);
const ARMY_KEYS = new Set([
  "id",
  "name",
  "location",
  "strength",
  "supply",
  "morale"
]);
const RELATION_VALUES = new Set([
  "ally",
  "enemy",
  "neutral",
  "overlord",
  "subject",
  "rival",
  "unknown"
]);
const MAX_TYPED_AGE_MS = 5 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;
const REVIEWED_TELEMETRY_MOD_VERSION = "0.5.0";
const PARTIAL_EXPORTS = Object.freeze({
  nation: Object.freeze({
    recordType: "player_summary",
    procedure: "emit_player_summary"
  }),
  economy: Object.freeze({
    recordType: "economy_snapshot",
    procedure: "emit_economy_snapshot"
  }),
  markets: Object.freeze({
    recordType: "markets_snapshot",
    procedure: "emit_markets_snapshot"
  }),
  diplomacy: Object.freeze({
    recordType: "diplomacy_snapshot",
    procedure: "emit_diplomacy_snapshot"
  }),
  military: Object.freeze({
    recordType: "military_snapshot",
    procedure: "emit_military_snapshot"
  })
});
const PARTIAL_FACTS = Object.freeze({
  nation: Object.freeze({
    atWar: Object.freeze({ availability: "available", type: "boolean" }),
    isSubject: Object.freeze({ availability: "available", type: "boolean" }),
    countryTag: Object.freeze({ availability: "available", type: "string" }),
    gameDateDisplay: Object.freeze({ availability: "available", type: "string" }),
    countryName: Object.freeze({
      availability: "unavailable",
      reason: "no_json_safe_scalar_serializer"
    }),
    gameDate: Object.freeze({
      availability: "unavailable",
      reason: "use_debug_log_date_or_external_observation"
    })
  }),
  economy: Object.freeze({
    estimatedMonthlyIncomeDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    estimatedTradeTaxIncomeDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    treasuryDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    monthlyBalanceDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    monthlyBalanceClass: Object.freeze({
      availability: "available",
      values: Object.freeze(["negative", "non_negative"])
    }),
    treasuryClass: Object.freeze({
      availability: "available",
      values: Object.freeze(["negative", "non_negative"])
    }),
    monthlyBalance: Object.freeze({
      availability: "unavailable",
      unit: "gold_per_month",
      reason: "no_json_safe_scalar_serializer"
    }),
    treasury: Object.freeze({
      availability: "unavailable",
      unit: "gold",
      reason: "no_json_safe_scalar_serializer"
    }),
    monthlyIncomeTotal: Object.freeze({
      availability: "unavailable",
      unit: "gold_per_month",
      reason: "no_json_safe_scalar_serializer"
    })
  }),
  markets: Object.freeze({
    capitalMarketIdDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    capitalMarketNameDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    capitalLocationMarketAccessDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    monthlyFoodBalanceDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    foodStockpileDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    maxFoodStockpileDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    foodStockpilePercentDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    foodPriceDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    totalValueTradedDisplay: Object.freeze({
      availability: "available",
      type: "string"
    }),
    marketCount: Object.freeze({
      availability: "unavailable",
      unit: "markets",
      reason: "no_json_safe_collection_serializer"
    }),
    shortages: Object.freeze({
      availability: "unavailable",
      reason: "no_json_safe_collection_serializer"
    })
  }),
  diplomacy: Object.freeze({
    atWar: Object.freeze({ availability: "available", type: "boolean" }),
    isSubject: Object.freeze({ availability: "available", type: "boolean" }),
    relations: Object.freeze({
      availability: "unavailable",
      reason: "no_json_safe_collection_serializer"
    }),
    allies: Object.freeze({
      availability: "unavailable",
      reason: "no_json_safe_collection_serializer"
    })
  }),
  military: Object.freeze({
    hasArmy: Object.freeze({ availability: "available", type: "boolean" }),
    hasNavy: Object.freeze({ availability: "available", type: "boolean" }),
    canRaiseArmyLevies: Object.freeze({ availability: "available", type: "boolean" }),
    armySizeDisplay: Object.freeze({ availability: "available", type: "string" }),
    navySizeDisplay: Object.freeze({ availability: "available", type: "string" }),
    manpowerDisplay: Object.freeze({ availability: "available", type: "string" }),
    manpower: Object.freeze({
      availability: "unavailable",
      unit: "people",
      reason: "no_json_safe_scalar_serializer"
    }),
    supplyStatus: Object.freeze({
      availability: "unavailable",
      reason: "requires_unit_scope_and_collection_serializer"
    })
  })
});

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, allowed, label, required = []) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label}.${key} is not allowed`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${label}.${key} is required`);
    }
  }
}

function assertShortString(value, label, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > maximum
  ) {
    throw new TypeError(`${label} must be a short non-empty string`);
  }
}

function isCanonicalUtc(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isGameDate(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function validateCountry(country, label = "payload.country") {
  assertExactKeys(country, COUNTRY_KEYS, label, ["tag", "name"]);
  if (!/^[A-Z0-9_]{2,16}$/.test(country.tag)) {
    throw new TypeError(`${label}.tag must be a canonical country tag`);
  }
  assertShortString(country.name, `${label}.name`);
  if (country.id !== undefined) assertShortString(country.id, `${label}.id`);
  return Object.freeze({
    ...(country.id === undefined ? {} : { id: country.id }),
    tag: country.tag,
    name: country.name
  });
}

function validateMetric(metric, expectedUnit, label) {
  assertExactKeys(metric, METRIC_KEYS, label, ["value", "unit"]);
  if (metric.unit !== expectedUnit) {
    throw new TypeError(`${label}.unit must be ${expectedUnit}`);
  }
  const validValue = expectedUnit === "boolean"
    ? metric.value === null || typeof metric.value === "boolean"
    : metric.value === null || Number.isFinite(metric.value);
  if (!validValue) {
    throw new TypeError(
      `${label}.value must be ${expectedUnit === "boolean" ? "boolean" : "finite"} or null`
    );
  }
  return Object.freeze({ value: metric.value, unit: metric.unit });
}

function validateMetrics(metrics, definition, label = "payload.metrics") {
  if (!isPlainObject(metrics)) throw new TypeError(`${label} must be an object`);
  const result = {};
  for (const [field, metric] of Object.entries(metrics)) {
    if (!Object.hasOwn(definition, field)) {
      throw new TypeError(`${label}.${field} is not allowed`);
    }
    result[field] = validateMetric(metric, definition[field], `${label}.${field}`);
  }
  return Object.freeze(result);
}

function validateMarket(market) {
  assertExactKeys(market, MARKET_KEYS, "payload.market", ["id", "name"]);
  assertShortString(market.id, "payload.market.id");
  assertShortString(market.name, "payload.market.name");
  return Object.freeze({ id: market.id, name: market.name });
}

function validateGoods(goods) {
  if (!Array.isArray(goods) || goods.length > 100) {
    throw new TypeError("payload.goods must be an array with at most 100 items");
  }
  return Object.freeze(goods.map((good, index) => {
    const label = `payload.goods[${index}]`;
    assertExactKeys(good, GOOD_KEYS, label, ["id", "name"]);
    assertShortString(good.id, `${label}.id`);
    assertShortString(good.name, `${label}.name`);
    return Object.freeze({
      id: good.id,
      name: good.name,
      ...(good.price === undefined
        ? {}
        : { price: validateMetric(good.price, "ducats_per_unit", `${label}.price`) }),
      ...(good.balance === undefined
        ? {}
        : { balance: validateMetric(good.balance, "units_per_month", `${label}.balance`) }),
      ...(good.stockpile === undefined
        ? {}
        : { stockpile: validateMetric(good.stockpile, "units", `${label}.stockpile`) })
    });
  }));
}

function validateRelations(relations) {
  if (!Array.isArray(relations) || relations.length > 100) {
    throw new TypeError("payload.relations must be an array with at most 100 items");
  }
  return Object.freeze(relations.map((relation, index) => {
    const label = `payload.relations[${index}]`;
    assertExactKeys(relation, RELATION_KEYS, label, ["country", "atWar"]);
    if (typeof relation.atWar !== "boolean") {
      throw new TypeError(`${label}.atWar must be a boolean`);
    }
    if (relation.relation !== undefined && !RELATION_VALUES.has(relation.relation)) {
      throw new TypeError(`${label}.relation is not allowed`);
    }
    if (
      relation.truceUntil !== undefined &&
      relation.truceUntil !== null &&
      !isGameDate(relation.truceUntil)
    ) {
      throw new TypeError(`${label}.truceUntil must be a game date or null`);
    }
    return Object.freeze({
      country: validateCountry(relation.country, `${label}.country`),
      ...(relation.opinion === undefined
        ? {}
        : { opinion: validateMetric(relation.opinion, "points", `${label}.opinion`) }),
      ...(relation.relation === undefined ? {} : { relation: relation.relation }),
      atWar: relation.atWar,
      ...(relation.truceUntil === undefined
        ? {}
        : { truceUntil: relation.truceUntil })
    });
  }));
}

function validateArmies(armies) {
  if (!Array.isArray(armies) || armies.length > 100) {
    throw new TypeError("payload.armies must be an array with at most 100 items");
  }
  return Object.freeze(armies.map((army, index) => {
    const label = `payload.armies[${index}]`;
    assertExactKeys(army, ARMY_KEYS, label, ["id", "name"]);
    assertShortString(army.id, `${label}.id`);
    assertShortString(army.name, `${label}.name`);
    if (army.location !== undefined) {
      assertShortString(army.location, `${label}.location`);
    }
    return Object.freeze({
      id: army.id,
      name: army.name,
      ...(army.location === undefined ? {} : { location: army.location }),
      ...(army.strength === undefined
        ? {}
        : { strength: validateMetric(army.strength, "soldiers", `${label}.strength`) }),
      ...(army.supply === undefined
        ? {}
        : { supply: validateMetric(army.supply, "percent", `${label}.supply`) }),
      ...(army.morale === undefined
        ? {}
        : { morale: validateMetric(army.morale, "percent", `${label}.morale`) })
    });
  }));
}

function validateTypedPayload(recordType, payload, { nowMs = Date.now() } = {}) {
  const definition = TYPED_RECORD_DEFINITIONS[recordType];
  if (!definition) throw new TypeError("record type is not typed telemetry");
  assertExactKeys(
    payload,
    COMMON_PAYLOAD_KEYS,
    "payload",
    ["country", "gameDate", "capturedAtUtc", "paused", "metrics"]
  );
  if (!isGameDate(payload.gameDate)) {
    throw new TypeError("payload.gameDate must be a valid YYYY-MM-DD game date");
  }
  if (!isCanonicalUtc(payload.capturedAtUtc)) {
    throw new TypeError("payload.capturedAtUtc must be canonical UTC");
  }
  const capturedMs = Date.parse(payload.capturedAtUtc);
  if (capturedMs > nowMs + MAX_FUTURE_SKEW_MS) {
    throw new RangeError("payload.capturedAtUtc is in the future");
  }
  if (nowMs - capturedMs > MAX_TYPED_AGE_MS) {
    throw new RangeError("payload.capturedAtUtc is stale");
  }
  if (typeof payload.paused !== "boolean") {
    throw new TypeError("payload.paused must be a boolean");
  }
  if (payload.gameBuild !== undefined) {
    assertShortString(payload.gameBuild, "payload.gameBuild");
  }

  const normalized = {
    country: validateCountry(payload.country),
    gameDate: payload.gameDate,
    capturedAtUtc: payload.capturedAtUtc,
    paused: payload.paused,
    ...(payload.gameBuild === undefined ? {} : { gameBuild: payload.gameBuild }),
    metrics: validateMetrics(payload.metrics, definition.metrics)
  };

  if (definition.domain === "markets") {
    if (payload.market !== undefined) normalized.market = validateMarket(payload.market);
    if (payload.goods !== undefined) normalized.goods = validateGoods(payload.goods);
  } else if (payload.market !== undefined || payload.goods !== undefined) {
    throw new TypeError("market fields are allowed only for markets_snapshot");
  }
  if (definition.domain === "diplomacy") {
    if (payload.relations !== undefined) {
      normalized.relations = validateRelations(payload.relations);
    }
  } else if (payload.relations !== undefined) {
    throw new TypeError("relations are allowed only for diplomacy_snapshot");
  }
  if (definition.domain === "military") {
    if (payload.armies !== undefined) normalized.armies = validateArmies(payload.armies);
  } else if (payload.armies !== undefined) {
    throw new TypeError("armies are allowed only for military_snapshot");
  }
  return Object.freeze(normalized);
}

function validatePartialTelemetryRecord(record) {
  if (
    !isPlainObject(record) ||
    record.modVersion !== REVIEWED_TELEMETRY_MOD_VERSION
  ) return null;
  const exportDefinition = PARTIAL_EXPORTS[record.section];
  if (!exportDefinition) return null;
  if (record.recordType !== "telemetry_fact") {
    const headerKeys = new Set([
      "schemaVersion",
      "recordType",
      "procedure",
      "section",
      "modVersion",
      "status",
      "completeness",
      "observationJoinRequired"
    ]);
    if (
      Object.keys(record).some((key) => !headerKeys.has(key)) ||
      Object.keys(record).length !== headerKeys.size ||
      record.recordType !== exportDefinition.recordType ||
      record.procedure !== exportDefinition.procedure ||
      record.status !== "acknowledged" ||
      record.completeness !== "partial" ||
      record.observationJoinRequired !== true
    ) {
      return null;
    }
    return Object.freeze({
      kind: "partial_export",
      domain: record.section,
      completeness: "partial"
    });
  }
  const factDefinition = PARTIAL_FACTS[record.section] &&
    PARTIAL_FACTS[record.section][record.field];
  const factKeys = new Set([
    "schemaVersion",
    "recordType",
    "procedure",
    "section",
    "field",
    "value",
    "availability",
    "modVersion",
    "status",
    ...(record.unit === undefined ? [] : ["unit"]),
    ...(record.reason === undefined ? [] : ["reason"])
  ]);
  if (
    Object.keys(record).some((key) => !factKeys.has(key)) ||
    Object.keys(record).length !== factKeys.size ||
    !factDefinition ||
    record.procedure !== exportDefinition.procedure ||
    record.status !== "observed" ||
    record.availability !== factDefinition.availability
  ) {
    return null;
  }
  if (factDefinition.availability === "available") {
    if (
      record.reason !== undefined ||
      record.unit !== undefined ||
      (factDefinition.type === "boolean" && typeof record.value !== "boolean") ||
      (factDefinition.type === "string" &&
        (typeof record.value !== "string" ||
          record.value.trim() === "" ||
          record.value.length > 256)) ||
      (factDefinition.values && !factDefinition.values.includes(record.value))
    ) {
      return null;
    }
  } else if (
    record.value !== null ||
    record.reason !== factDefinition.reason ||
    (factDefinition.unit === undefined
      ? record.unit !== undefined
      : record.unit !== factDefinition.unit)
  ) {
    return null;
  }
  return Object.freeze({
    kind: "partial_fact",
    domain: record.section,
    field: record.field,
    value: record.value,
    availability: record.availability,
    ...(record.unit === undefined ? {} : { unit: record.unit }),
    ...(record.reason === undefined ? {} : { reason: record.reason })
  });
}

function latestVerifiedState(records) {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  const candidates = records.filter((record) =>
    record &&
    record.recordType === "nation_snapshot" &&
    record.provenance &&
    record.provenance.adapter &&
    record.provenance.adapter.id === "eu5-control-bridge" &&
    record.provenance.adapter.version === "1" &&
    record.provenance.verification &&
    record.provenance.verification.status === "verified" &&
    record.provenance.freshness === "fresh" &&
    record.subject &&
    typeof record.subject.campaignId === "string" &&
    typeof record.subject.countryTag === "string" &&
    typeof record.subject.countryName === "string" &&
    record.payload &&
    typeof record.payload.domain === "string"
  );
  if (!candidates.length) {
    return Object.freeze({
      status: "unavailable",
      country: null,
      gameDate: null,
      paused: null,
      updatedAtUtc: null,
      domains: Object.freeze({}),
      warnings: Object.freeze(["No fresh verified typed telemetry is available."])
    });
  }
  candidates.sort((left, right) =>
    Date.parse(right.payload.capturedAtUtc) - Date.parse(left.payload.capturedAtUtc)
  );
  const anchor = candidates[0];
  const campaignId = anchor.subject.campaignId;
  const countryTag = anchor.subject.countryTag;
  const gameDate = anchor.payload.gameDate;
  const paused = anchor.payload.paused;
  const domains = {};
  for (const record of candidates) {
    if (
      record.subject.campaignId !== campaignId ||
      record.subject.countryTag !== countryTag ||
      record.subject.countryName !== anchor.subject.countryName ||
      record.payload.gameDate !== gameDate ||
      record.payload.paused !== paused ||
      Object.hasOwn(domains, record.payload.domain)
    ) {
      continue;
    }
    domains[record.payload.domain] = Object.freeze({
      recordId: record.recordId,
      capturedAtUtc: record.payload.capturedAtUtc,
      gameDate: record.payload.gameDate,
      paused: record.payload.paused,
      metrics: record.payload.metrics,
      ...(record.payload.market === undefined ? {} : { market: record.payload.market }),
      ...(record.payload.goods === undefined ? {} : { goods: record.payload.goods }),
      ...(record.payload.relations === undefined ? {} : { relations: record.payload.relations }),
      ...(record.payload.armies === undefined ? {} : { armies: record.payload.armies })
    });
  }
  const warnings = [];
  for (const domain of ["player", "economy", "markets", "diplomacy", "military"]) {
    if (!Object.hasOwn(domains, domain)) warnings.push(`Missing ${domain} telemetry.`);
  }
  return Object.freeze({
    status: warnings.length ? "partial" : "available",
    campaignId,
    country: Object.freeze({
      ...(anchor.subject.countryId ? { id: anchor.subject.countryId } : {}),
      tag: countryTag,
      name: anchor.subject.countryName
    }),
    gameDate,
    paused,
    updatedAtUtc: anchor.payload.capturedAtUtc,
    domains: Object.freeze(domains),
    warnings: Object.freeze(warnings)
  });
}

module.exports = {
  MAX_FUTURE_SKEW_MS,
  MAX_TYPED_AGE_MS,
  PARTIAL_EXPORTS,
  PARTIAL_FACTS,
  REVIEWED_TELEMETRY_MOD_VERSION,
  TYPED_RECORD_DEFINITIONS,
  TYPED_RECORD_TYPES,
  isCanonicalUtc,
  isGameDate,
  latestVerifiedState,
  validatePartialTelemetryRecord,
  validateTypedPayload
};
