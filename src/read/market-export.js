"use strict";

// This is the sole fixture-derived contract for the future
// `export_market_capacity` artifact. It remains unverified until an in-game
// export is available; do not treat these names or values as game semantics.
const EXPECTED_MARKET_CAPACITY_HEADER = Object.freeze([
  "market_id",
  "good_id",
  "capacity"
]);
const MAX_CONTENT_BYTES = 1024 * 1024;
const MAX_DATA_ROWS = 10_000;

function parseMarketCapacityExport(content) {
  if (typeof content !== "string") {
    throw new TypeError("market capacity export content must be a string");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    throw new RangeError("market capacity export exceeds the maximum content size");
  }
  if (content.includes("\0")) {
    throw new TypeError("market capacity export must not contain NUL bytes");
  }

  const normalized = content.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length < 2) {
    throw new TypeError("market capacity export must contain a header and at least one data row");
  }
  if (lines.some((line) => line === "")) {
    throw new TypeError("market capacity export must not contain blank rows");
  }

  const header = parseFields(lines[0], "header");
  if (new Set(header).size !== header.length) {
    throw new TypeError("market capacity export header contains duplicate columns");
  }
  if (!sameFields(header, EXPECTED_MARKET_CAPACITY_HEADER)) {
    throw new TypeError("market capacity export header does not match the fixture-derived format");
  }
  if (lines.length - 1 > MAX_DATA_ROWS) {
    throw new RangeError("market capacity export exceeds the maximum row count");
  }

  const rows = lines.slice(1).map((line, index) => {
    const fields = parseFields(line, `row ${index + 2}`);
    if (fields.length !== EXPECTED_MARKET_CAPACITY_HEADER.length) {
      throw new TypeError(`market capacity export row ${index + 2} has an unexpected column count`);
    }
    if (fields.some((field) => field.length === 0)) {
      throw new TypeError(`market capacity export row ${index + 2} contains an empty field`);
    }
    return Object.freeze(Object.fromEntries(
      EXPECTED_MARKET_CAPACITY_HEADER.map((name, fieldIndex) => [name, fields[fieldIndex]])
    ));
  });

  return Object.freeze({
    schemaVersion: 1,
    formatStatus: "fixture-derived-unverified",
    header: EXPECTED_MARKET_CAPACITY_HEADER,
    rowCount: rows.length,
    rows: Object.freeze(rows)
  });
}

function parseFields(line, label) {
  if (line.includes("\r")) {
    throw new TypeError(`market capacity export ${label} contains an invalid carriage return`);
  }
  return line.split("\t");
}

function sameFields(left, right) {
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

module.exports = {
  EXPECTED_MARKET_CAPACITY_HEADER,
  MAX_CONTENT_BYTES,
  MAX_DATA_ROWS,
  parseMarketCapacityExport
};
