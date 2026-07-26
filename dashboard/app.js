(function dashboardModule(globalScope) {
  "use strict";

  const SNAPSHOT_SCHEMA = "eu5.before-after-dashboard.snapshot/v1";
  const PAIR_SCHEMA = "eu5.before-after-dashboard.pair/v1";
  const CLASSIFICATIONS = new Set([
    "verified-snapshot-pair",
    "candidate-snapshot-pair",
    "fixture-example"
  ]);
  const FRESHNESS_VALUES = new Set(["fresh", "stale", "unknown"]);
  const VERIFICATION_VALUES = new Set(["verified", "unverified", "fixture"]);
  const SHA256_PATTERN = /^[0-9a-f]{64}$/;
  const CANONICAL_UTC_TIMESTAMP_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;
  const LIMITS = Object.freeze({
    MAX_FILE_BYTES: 1024 * 1024,
    MAX_STATE_DEPTH: 16,
    MAX_FIELDS_PER_SNAPSHOT: 2000,
    MAX_ARRAY_LENGTH: 250,
    MAX_RENDERED_ROWS: 2000
  });
  const MISSING = Symbol("missing");

  function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function assertNonEmptyString(value, path) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${path} must be a non-empty string`);
    }
  }

  function parseCanonicalUtcTimestamp(value, path) {
    assertNonEmptyString(value, path);
    const match = CANONICAL_UTC_TIMESTAMP_PATTERN.exec(value);
    if (!match) {
      throw new Error(
        `${path} must use canonical UTC form YYYY-MM-DDTHH:mm:ss(.sss)?Z`
      );
    }

    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [
      0,
      31,
      isLeapYear ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31
    ];

    if (
      year === 0 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > daysInMonth[month] ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      throw new Error(`${path} must be a calendar-valid UTC timestamp`);
    }

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      throw new Error(`${path} is outside the supported timestamp range`);
    }
    return timestamp;
  }

  function assertSha256(value, path) {
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
      throw new Error(`${path} must be exactly 64 lowercase hexadecimal characters`);
    }
  }

  function validateStateBounds(state, path) {
    if (!isPlainObject(state)) {
      throw new Error(`${path} must be an object`);
    }

    const seen = new WeakSet();
    const stack = [{ value: state, depth: 0 }];
    let fieldCount = 0;

    while (stack.length > 0) {
      const { value, depth } = stack.pop();
      if (Array.isArray(value) || isPlainObject(value)) {
        if (depth > LIMITS.MAX_STATE_DEPTH) {
          throw new Error(
            `${path} exceeds maximum nesting depth ${LIMITS.MAX_STATE_DEPTH}`
          );
        }
        if (seen.has(value)) {
          throw new Error(`${path} must be a JSON tree without circular or shared references`);
        }
        seen.add(value);

        if (Array.isArray(value)) {
          if (value.length > LIMITS.MAX_ARRAY_LENGTH) {
            throw new Error(
              `${path} array exceeds maximum length ${LIMITS.MAX_ARRAY_LENGTH}`
            );
          }
          fieldCount += value.length;
          if (fieldCount > LIMITS.MAX_FIELDS_PER_SNAPSHOT) {
            throw new Error(
              `${path} exceeds maximum field count ${LIMITS.MAX_FIELDS_PER_SNAPSHOT}`
            );
          }
          for (let index = value.length - 1; index >= 0; index -= 1) {
            stack.push({ value: value[index], depth: depth + 1 });
          }
          continue;
        }

        const keys = Object.keys(value);
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          const key = keys[index];
          if (key.length === 0 || key.includes(".")) {
            throw new Error(`${path} field keys must be non-empty and cannot contain "."`);
          }
          fieldCount += 1;
          if (fieldCount > LIMITS.MAX_FIELDS_PER_SNAPSHOT) {
            throw new Error(
              `${path} exceeds maximum field count ${LIMITS.MAX_FIELDS_PER_SNAPSHOT}`
            );
          }
          stack.push({ value: value[key], depth: depth + 1 });
        }
        continue;
      }

      const primitiveType = typeof value;
      if (
        value === null ||
        primitiveType === "string" ||
        primitiveType === "boolean" ||
        (primitiveType === "number" && Number.isFinite(value))
      ) {
        continue;
      }
      throw new Error(`${path} contains a value that is not valid finite JSON data`);
    }

    return { fieldCount };
  }

  function validateSnapshot(snapshot, expectedRole) {
    if (!isPlainObject(snapshot)) {
      throw new Error(`${expectedRole} snapshot must be an object`);
    }
    if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA) {
      throw new Error(`${expectedRole}.schemaVersion must be ${SNAPSHOT_SCHEMA}`);
    }
    if (snapshot.role !== expectedRole) {
      throw new Error(`${expectedRole}.role must be "${expectedRole}"`);
    }
    assertNonEmptyString(snapshot.snapshotId, `${expectedRole}.snapshotId`);
    assertNonEmptyString(snapshot.captureSessionId, `${expectedRole}.captureSessionId`);
    assertNonEmptyString(snapshot.entityId, `${expectedRole}.entityId`);
    if (!isPlainObject(snapshot.adapter)) {
      throw new Error(`${expectedRole}.adapter must be an object`);
    }
    assertNonEmptyString(snapshot.adapter.id, `${expectedRole}.adapter.id`);
    assertNonEmptyString(snapshot.adapter.version, `${expectedRole}.adapter.version`);
    assertSha256(snapshot.rawContentSha256, `${expectedRole}.rawContentSha256`);
    assertSha256(
      snapshot.fieldDefinitionFingerprint,
      `${expectedRole}.fieldDefinitionFingerprint`
    );
    parseCanonicalUtcTimestamp(snapshot.capturedAt, `${expectedRole}.capturedAt`);
    if (snapshot.gameTime !== null && typeof snapshot.gameTime !== "string") {
      throw new Error(`${expectedRole}.gameTime must be a string or null`);
    }
    if (!isPlainObject(snapshot.source)) {
      throw new Error(`${expectedRole}.source must be an object`);
    }
    assertNonEmptyString(snapshot.source.label, `${expectedRole}.source.label`);
    assertNonEmptyString(snapshot.source.kind, `${expectedRole}.source.kind`);
    if (!FRESHNESS_VALUES.has(snapshot.source.freshness)) {
      throw new Error(`${expectedRole}.source.freshness must be fresh, stale, or unknown`);
    }
    if (!isPlainObject(snapshot.source.verification)) {
      throw new Error(`${expectedRole}.source.verification must be an object`);
    }
    if (!VERIFICATION_VALUES.has(snapshot.source.verification.status)) {
      throw new Error(
        `${expectedRole}.source.verification.status must be verified, unverified, or fixture`
      );
    }
    assertNonEmptyString(
      snapshot.source.verification.evidence,
      `${expectedRole}.source.verification.evidence`
    );
    validateStateBounds(snapshot.state, `${expectedRole}.state`);
    return snapshot;
  }

  function assertPairValuesMatch(before, after, path, accessor) {
    if (accessor(before) !== accessor(after)) {
      throw new Error(`${path} must match across before and after snapshots`);
    }
  }

  function validatePair(pair) {
    if (!isPlainObject(pair)) {
      throw new Error("Snapshot pair must be an object");
    }
    if (pair.schemaVersion !== PAIR_SCHEMA) {
      throw new Error(`schemaVersion must be ${PAIR_SCHEMA}`);
    }
    if (!CLASSIFICATIONS.has(pair.classification)) {
      throw new Error(
        "classification must be verified-snapshot-pair, candidate-snapshot-pair, or fixture-example"
      );
    }
    assertNonEmptyString(pair.displayLabel, "displayLabel");
    const before = validateSnapshot(pair.before, "before");
    const after = validateSnapshot(pair.after, "after");
    const verificationStatuses = [
      before.source.verification.status,
      after.source.verification.status
    ];
    if (before.snapshotId === after.snapshotId) {
      throw new Error("before.snapshotId and after.snapshotId must be unique");
    }
    assertPairValuesMatch(
      before,
      after,
      "captureSessionId",
      (snapshot) => snapshot.captureSessionId
    );
    assertPairValuesMatch(before, after, "entityId", (snapshot) => snapshot.entityId);
    assertPairValuesMatch(before, after, "adapter.id", (snapshot) => snapshot.adapter.id);
    assertPairValuesMatch(
      before,
      after,
      "adapter.version",
      (snapshot) => snapshot.adapter.version
    );
    assertPairValuesMatch(
      before,
      after,
      "fieldDefinitionFingerprint",
      (snapshot) => snapshot.fieldDefinitionFingerprint
    );
    if (pair.classification === "verified-snapshot-pair") {
      if (!verificationStatuses.every((status) => status === "verified")) {
        throw new Error("verified-snapshot-pair requires both snapshots to be verified");
      }
      if (
        before.source.freshness !== "fresh" ||
        after.source.freshness !== "fresh"
      ) {
        throw new Error("verified-snapshot-pair requires both snapshots to be fresh");
      }
      if (before.source.kind !== after.source.kind) {
        throw new Error(
          "verified-snapshot-pair requires source.kind to match across snapshots"
        );
      }
      if (before.rawContentSha256 === after.rawContentSha256) {
        throw new Error(
          "verified-snapshot-pair requires distinct rawContentSha256 values"
        );
      }
    }
    if (
      pair.classification === "fixture-example" &&
      !verificationStatuses.every((status) => status === "fixture")
    ) {
      throw new Error("fixture-example pairs must mark both snapshots as fixture");
    }
    if (
      pair.classification === "candidate-snapshot-pair" &&
      verificationStatuses.some((status) => status === "fixture")
    ) {
      throw new Error("candidate-snapshot-pair cannot contain fixture snapshots");
    }
    const beforeTimestamp = parseCanonicalUtcTimestamp(
      before.capturedAt,
      "before.capturedAt"
    );
    const afterTimestamp = parseCanonicalUtcTimestamp(after.capturedAt, "after.capturedAt");
    if (afterTimestamp <= beforeTimestamp) {
      throw new Error("after.capturedAt must be strictly later than before.capturedAt");
    }
    return {
      schemaVersion: pair.schemaVersion,
      classification: pair.classification,
      displayLabel: pair.displayLabel,
      before,
      after
    };
  }

  function flattenState(value) {
    validateStateBounds(value, "state");
    const target = new Map();
    const stack = [{ value, path: "" }];

    while (stack.length > 0) {
      const item = stack.pop();
      if (isPlainObject(item.value)) {
        const keys = Object.keys(item.value).sort().reverse();
        if (keys.length === 0 && item.path) {
          target.set(item.path, {});
        } else {
          for (const key of keys) {
            stack.push({
              value: item.value[key],
              path: item.path ? `${item.path}.${key}` : key
            });
          }
        }
      } else if (item.path) {
        target.set(item.path, item.value);
      }
    }
    return target;
  }

  function stableValue(value) {
    if (Array.isArray(value)) {
      return `[${value.map(stableValue).join(",")}]`;
    }
    if (isPlainObject(value)) {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function classifyField(beforeValue, afterValue) {
    if (
      beforeValue === MISSING ||
      afterValue === MISSING ||
      beforeValue === null ||
      afterValue === null ||
      typeof beforeValue === "undefined" ||
      typeof afterValue === "undefined"
    ) {
      return "unknown";
    }
    return stableValue(beforeValue) === stableValue(afterValue) ? "unchanged" : "changed";
  }

  function formatValue(value) {
    if (value === MISSING) {
      return "Not supplied";
    }
    if (value === null || typeof value === "undefined") {
      return "Unknown";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return stableValue(value);
  }

  function compareStates(beforeState, afterState) {
    const beforeFields = flattenState(beforeState);
    const afterFields = flattenState(afterState);
    const paths = [...new Set([...beforeFields.keys(), ...afterFields.keys()])].sort((a, b) =>
      a.localeCompare(b)
    );
    if (paths.length > LIMITS.MAX_RENDERED_ROWS) {
      throw new Error(
        `Comparison exceeds maximum rendered rows ${LIMITS.MAX_RENDERED_ROWS}`
      );
    }
    const rows = paths.map((path) => {
      const before = beforeFields.has(path) ? beforeFields.get(path) : MISSING;
      const after = afterFields.has(path) ? afterFields.get(path) : MISSING;
      return {
        path,
        before: formatValue(before),
        after: formatValue(after),
        status: classifyField(before, after)
      };
    });
    const counts = rows.reduce(
      (result, row) => {
        result[row.status] += 1;
        return result;
      },
      { changed: 0, unchanged: 0, unknown: 0 }
    );
    return { rows, counts };
  }

  function emptyModel() {
    return {
      status: "awaiting",
      statusLabel: "Awaiting verified snapshots",
      message: "No snapshot data loaded. See README.md for the local data contract.",
      pair: null,
      comparison: { rows: [], counts: null }
    };
  }

  function buildModel(pairInput) {
    const pair = validatePair(pairInput);
    const comparison = compareStates(pair.before.state, pair.after.state);
    const verificationStatuses = [
      pair.before.source.verification.status,
      pair.after.source.verification.status
    ];
    let status = "unverified";
    let statusLabel = "Loaded snapshots are not fully verified";

    if (pair.classification === "fixture-example") {
      status = "fixture";
      statusLabel = "Fixture / example — not real EU5 state";
    } else if (
      pair.classification === "verified-snapshot-pair" &&
      verificationStatuses.every((value) => value === "verified")
    ) {
      status = "ready";
      statusLabel = "Verified snapshots loaded";
    }

    return {
      status,
      statusLabel,
      message: `${pair.displayLabel}: ${comparison.rows.length} field(s) compared locally.`,
      pair,
      comparison
    };
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function setText(element, value) {
    element.textContent = value;
  }

  function setBadge(element, value, kind) {
    setText(element, value);
    element.className = `badge badge-${kind}`;
  }

  function renderSnapshot(elements, prefix, snapshot) {
    if (!snapshot) {
      setText(elements[`${prefix}Source`], "Not supplied");
      setText(elements[`${prefix}Captured`], "Unknown");
      setText(elements[`${prefix}GameTime`], "Unknown");
      setBadge(elements[`${prefix}Freshness`], "Unknown", "unknown");
      setBadge(elements[`${prefix}Verification`], "Unknown", "unknown");
      return;
    }

    setText(
      elements[`${prefix}Source`],
      `${snapshot.source.label} (${snapshot.source.kind}; ${snapshot.adapter.id}@${snapshot.adapter.version})`
    );
    setText(elements[`${prefix}Captured`], snapshot.capturedAt);
    setText(elements[`${prefix}GameTime`], snapshot.gameTime || "Unknown");
    setBadge(
      elements[`${prefix}Freshness`],
      snapshot.source.freshness,
      snapshot.source.freshness
    );
    setBadge(
      elements[`${prefix}Verification`],
      snapshot.source.verification.status,
      snapshot.source.verification.status
    );
    elements[`${prefix}Verification`].title = snapshot.source.verification.evidence;
  }

  function appendDetailRow(documentRef, tableBody, row) {
    const tr = documentRef.createElement("tr");
    const pathCell = documentRef.createElement("td");
    const beforeCell = documentRef.createElement("td");
    const afterCell = documentRef.createElement("td");
    const statusCell = documentRef.createElement("td");
    const status = documentRef.createElement("span");

    setText(pathCell, row.path);
    setText(beforeCell, row.before);
    setText(afterCell, row.after);
    setText(status, row.status);
    status.className = `detail-status detail-status-${row.status}`;
    statusCell.appendChild(status);
    tr.append(pathCell, beforeCell, afterCell, statusCell);
    tableBody.appendChild(tr);
  }

  function appendEmptyRow(documentRef, tableBody, message) {
    const tr = documentRef.createElement("tr");
    const td = documentRef.createElement("td");
    tr.className = "empty-row";
    td.colSpan = 4;
    setText(td, message);
    tr.appendChild(td);
    tableBody.appendChild(tr);
  }

  function renderModel(documentRef, elements, model, filter) {
    setText(elements.overallStatus, model.statusLabel);
    elements.overallStatus.className = `status status-${model.status}`;
    setText(elements.inputMessage, model.message);
    elements.inputMessage.classList.remove("input-message-error");

    const pair = model.pair;
    renderSnapshot(elements, "before", pair && pair.before);
    renderSnapshot(elements, "after", pair && pair.after);

    const isFixture = Boolean(pair && pair.classification === "fixture-example");
    elements.fixtureWarning.hidden = !isFixture;
    setText(elements.fixtureLabel, isFixture ? pair.displayLabel : "");

    const counts = model.comparison.counts;
    setText(elements.changedCount, counts ? String(counts.changed) : "—");
    setText(elements.unchangedCount, counts ? String(counts.unchanged) : "—");
    setText(elements.unknownCount, counts ? String(counts.unknown) : "—");

    elements.detailBody.replaceChildren();
    const selectedFilter = filter || "all";
    const visibleRows = model.comparison.rows.filter(
      (row) => selectedFilter === "all" || row.status === selectedFilter
    );
    if (visibleRows.length === 0) {
      const message = pair
        ? `No ${selectedFilter === "all" ? "" : `${selectedFilter} `}fields to display.`
        : "Awaiting verified snapshots. No game-state values are loaded.";
      appendEmptyRow(documentRef, elements.detailBody, message);
      return;
    }
    for (const row of visibleRows) {
      appendDetailRow(documentRef, elements.detailBody, row);
    }
  }

  async function readJsonFile(file) {
    if (
      !file ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      typeof file.text !== "function"
    ) {
      throw new Error("Selected input is not a valid local file");
    }
    if (file.size > LIMITS.MAX_FILE_BYTES) {
      throw new Error(
        `${file.name || "Selected file"} exceeds maximum size ${LIMITS.MAX_FILE_BYTES} bytes`
      );
    }

    const text = await file.text();
    const actualBytes = new TextEncoder().encode(text).byteLength;
    if (actualBytes > LIMITS.MAX_FILE_BYTES) {
      throw new Error(
        `${file.name || "Selected file"} exceeds maximum size ${LIMITS.MAX_FILE_BYTES} bytes`
      );
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`${file.name || "Selected file"}: invalid JSON (${error.message})`);
    }
  }

  function collectElements(documentRef) {
    return {
      overallStatus: documentRef.getElementById("overall-status"),
      inputMessage: documentRef.getElementById("input-message"),
      fixtureWarning: documentRef.getElementById("fixture-warning"),
      fixtureLabel: documentRef.getElementById("fixture-label"),
      beforeSource: documentRef.getElementById("before-source"),
      beforeCaptured: documentRef.getElementById("before-captured"),
      beforeGameTime: documentRef.getElementById("before-game-time"),
      beforeFreshness: documentRef.getElementById("before-freshness"),
      beforeVerification: documentRef.getElementById("before-verification"),
      afterSource: documentRef.getElementById("after-source"),
      afterCaptured: documentRef.getElementById("after-captured"),
      afterGameTime: documentRef.getElementById("after-game-time"),
      afterFreshness: documentRef.getElementById("after-freshness"),
      afterVerification: documentRef.getElementById("after-verification"),
      changedCount: documentRef.getElementById("changed-count"),
      unchangedCount: documentRef.getElementById("unchanged-count"),
      unknownCount: documentRef.getElementById("unknown-count"),
      detailBody: documentRef.getElementById("detail-body")
    };
  }

  function initialize(documentRef) {
    const elements = collectElements(documentRef);
    const pairInput = documentRef.getElementById("pair-file");
    const beforeInput = documentRef.getElementById("before-file");
    const afterInput = documentRef.getElementById("after-file");
    const resetButton = documentRef.getElementById("reset-button");
    const filter = documentRef.getElementById("status-filter");
    let currentModel = emptyModel();
    let individualSnapshots = { before: null, after: null };

    function render() {
      renderModel(documentRef, elements, currentModel, filter.value);
    }

    function showError(error) {
      currentModel = emptyModel();
      render();
      setText(elements.inputMessage, `Cannot compare snapshots: ${error.message}`);
      elements.inputMessage.classList.add("input-message-error");
    }

    pairInput.addEventListener("change", async () => {
      const file = pairInput.files && pairInput.files[0];
      if (!file) {
        return;
      }
      try {
        currentModel = buildModel(await readJsonFile(file));
        individualSnapshots = { before: null, after: null };
        beforeInput.value = "";
        afterInput.value = "";
        render();
      } catch (error) {
        showError(error);
      }
    });

    async function loadIndividual(role, file) {
      if (!file) {
        individualSnapshots[role] = null;
        currentModel = emptyModel();
        currentModel.message = `Waiting for a valid ${role === "before" ? "after" : "before"} snapshot.`;
        render();
        return;
      }
      try {
        individualSnapshots[role] = validateSnapshot(await readJsonFile(file), role);
        pairInput.value = "";
        if (individualSnapshots.before && individualSnapshots.after) {
          currentModel = buildModel({
            schemaVersion: PAIR_SCHEMA,
            classification: "candidate-snapshot-pair",
            displayLabel: "Individually supplied snapshot pair",
            before: individualSnapshots.before,
            after: individualSnapshots.after
          });
        } else {
          currentModel = emptyModel();
          currentModel.message = `Valid ${role} snapshot loaded; waiting for ${
            role === "before" ? "after" : "before"
          } snapshot.`;
        }
        render();
      } catch (error) {
        individualSnapshots[role] = null;
        showError(error);
      }
    }

    beforeInput.addEventListener("change", () =>
      loadIndividual("before", beforeInput.files && beforeInput.files[0])
    );
    afterInput.addEventListener("change", () =>
      loadIndividual("after", afterInput.files && afterInput.files[0])
    );
    filter.addEventListener("change", render);
    resetButton.addEventListener("click", () => {
      currentModel = emptyModel();
      individualSnapshots = { before: null, after: null };
      pairInput.value = "";
      beforeInput.value = "";
      afterInput.value = "";
      filter.value = "all";
      render();
    });

    render();
  }

  const api = {
    SNAPSHOT_SCHEMA,
    PAIR_SCHEMA,
    LIMITS,
    buildModel,
    classifyField,
    compareStates,
    emptyModel,
    escapeHtml,
    flattenState,
    formatValue,
    parseCanonicalUtcTimestamp,
    readJsonFile,
    validateStateBounds,
    validatePair,
    validateSnapshot
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.EU5BeforeAfterDashboard = api;
  }
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => initialize(document));
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
