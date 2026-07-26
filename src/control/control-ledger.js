"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LEDGER_FILE = "control-ledger.jsonl";

function resolveDataDirectory(configuredDirectory) {
  const candidate = configuredDirectory || process.env.EU5_CONTROL_DATA_DIR ||
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "eu5-control-mcp");
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw new TypeError("EU5 control data directory must be a non-empty path");
  }
  return path.resolve(candidate);
}

class ControlLedger {
  constructor({ dataDirectory } = {}) {
    this.dataDirectory = resolveDataDirectory(dataDirectory);
    fs.mkdirSync(this.dataDirectory, { recursive: true });
    this.filePath = path.join(this.dataDirectory, LEDGER_FILE);
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, "", { flag: "wx" });
  }

  append(event) {
    if (!event || typeof event !== "object") throw new TypeError("ledger event is required");
    const record = Object.freeze({ ...event, recordedAtUtc: new Date().toISOString() });
    fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
    return record;
  }

  readAll() {
    const contents = fs.readFileSync(this.filePath, "utf8");
    if (!contents.trim()) return [];
    return contents.trimEnd().split("\n").map((line, index) => {
      try { return JSON.parse(line); } catch { throw new Error(`Invalid JSONL ledger record at line ${index + 1}`); }
    });
  }
}

module.exports = { ControlLedger, LEDGER_FILE, resolveDataDirectory };
