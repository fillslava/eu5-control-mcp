"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EXPECTED_MARKET_CAPACITY_HEADER,
  MAX_CONTENT_BYTES,
  MAX_DATA_ROWS,
  parseMarketCapacityExport
} = require("../src/read/market-export");

// Documented fixture only. No in-game EU5 `export_market_capacity` artifact
// has been supplied, so this format contract is intentionally unverified.
const FIXTURE = [
  "market_id\tgood_id\tcapacity",
  "amsterdam\tgrain\t42",
  "antwerp\tiron\t7"
].join("\n");

test("parses the fixture-derived fixed TSV format with BOM and CRLF", () => {
  const result = parseMarketCapacityExport(`\uFEFF${FIXTURE.replaceAll("\n", "\r\n")}\r\n`);

  assert.equal(result.formatStatus, "fixture-derived-unverified");
  assert.deepEqual(result.header, EXPECTED_MARKET_CAPACITY_HEADER);
  assert.equal(result.rowCount, 2);
  assert.deepEqual(result.rows, [
    { market_id: "amsterdam", good_id: "grain", capacity: "42" },
    { market_id: "antwerp", good_id: "iron", capacity: "7" }
  ]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.rows));
});

test("rejects malformed, duplicate, or unexpected headers", () => {
  assert.throws(() => parseMarketCapacityExport("good_id\tmarket_id\tcapacity\na\tb\tc"), /header does not match/);
  assert.throws(() => parseMarketCapacityExport("market_id\tmarket_id\tcapacity\na\tb\tc"), /duplicate columns/);
  assert.throws(() => parseMarketCapacityExport("market_id\tgood_id\na\tb"), /header does not match/);
});

test("rejects malformed rows", () => {
  assert.throws(() => parseMarketCapacityExport("market_id\tgood_id\tcapacity\na\tb"), /unexpected column count/);
  assert.throws(() => parseMarketCapacityExport("market_id\tgood_id\tcapacity\na\t\t3"), /empty field/);
  assert.throws(() => parseMarketCapacityExport("market_id\tgood_id\tcapacity\na\tb\t3\n\nc\td\t4"), /blank rows/);
  assert.throws(() => parseMarketCapacityExport("market_id\tgood_id\tcapacity\na\tb\t3\rc\td\t4"), /invalid carriage return/);
});

test("rejects non-string and unexpectedly huge content", () => {
  assert.throws(() => parseMarketCapacityExport(Buffer.from(FIXTURE)), /must be a string/);
  assert.throws(() => parseMarketCapacityExport(`${FIXTURE}\0`), /must not contain NUL/);
  assert.throws(() => parseMarketCapacityExport(`market_id\tgood_id\tcapacity\n${"x".repeat(MAX_CONTENT_BYTES)}`), /maximum content size/);
  const tooManyRows = `market_id\tgood_id\tcapacity\n${Array(MAX_DATA_ROWS + 1).fill("a\tb\tc").join("\n")}`;
  assert.throws(() => parseMarketCapacityExport(tooManyRows), /maximum row count/);
});

test("accepts the exact byte limit and one final newline", () => {
  const prefix = "market_id\tgood_id\tcapacity\n";
  const row = "a\tb\t";
  const content = `${prefix}${row}${"x".repeat(MAX_CONTENT_BYTES - Buffer.byteLength(prefix) - Buffer.byteLength(row) - 1)}\n`;
  assert.equal(Buffer.byteLength(content), MAX_CONTENT_BYTES);
  assert.equal(parseMarketCapacityExport(content).rowCount, 1);
});
