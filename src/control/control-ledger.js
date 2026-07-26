"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const LEDGER_FILE = "control-ledger.jsonl";
const LEDGER_LOCK_SCHEMA = "eu5.control-ledger-lock/v1";
const LEDGER_LOCK_WAIT_MS = 1_000;
const LEDGER_LOCK_RETRY_MS = 10;
const ACTIVE_WRITES = new Set();
const LOCK_WAIT_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function computeLedgerRecordHash(record) {
  if (!isPlainObject(record)) throw new TypeError("ledger record must be an object");
  const copy = { ...record };
  delete copy.recordHash;
  return crypto.createHash("sha256").update(stableStringify(copy)).digest("hex");
}

function validateLedgerRecords(records) {
  if (!Array.isArray(records)) throw new TypeError("ledger records must be an array");
  let previousHash = null;
  records.forEach((record, index) => {
    if (!isPlainObject(record)) throw new Error(`Invalid ledger record at line ${index + 1}`);
    if (record.sequence !== index) {
      throw new Error(`Invalid ledger sequence at line ${index + 1}`);
    }
    if (record.previousHash !== previousHash) {
      throw new Error(`Invalid ledger previousHash at line ${index + 1}`);
    }
    if (
      typeof record.recordHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.recordHash) ||
      computeLedgerRecordHash(record) !== record.recordHash
    ) {
      throw new Error(`Invalid ledger recordHash at line ${index + 1}`);
    }
    previousHash = record.recordHash;
  });
  return Object.freeze({
    valid: true,
    length: records.length,
    tailHash: previousHash
  });
}

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
    this.lockPath = `${this.filePath}.lock`;
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, "", { flag: "wx" });
  }

  validate() {
    return validateLedgerRecords(this.readAll());
  }

  append(event, options = {}) {
    return this.appendMany([event], options)[0];
  }

  validateAppendRequest(events, recordedAtUtc) {
    if (!Array.isArray(events) || events.length === 0) {
      throw new TypeError("ledger events must be a non-empty array");
    }
    if (!Number.isFinite(Date.parse(recordedAtUtc))) {
      throw new TypeError("recordedAtUtc must be ISO-8601");
    }
    for (const event of events) {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new TypeError("ledger event is required");
      }
      for (const reserved of ["sequence", "previousHash", "recordHash", "recordedAtUtc"]) {
        if (Object.hasOwn(event, reserved)) {
          throw new TypeError(`ledger event cannot supply reserved field ${reserved}`);
        }
      }
    }
  }

  withWriteLock(operation) {
    if (ACTIVE_WRITES.has(this.filePath)) {
      throw new Error("concurrent ledger append rejected");
    }
    ACTIVE_WRITES.add(this.filePath);
    let lock = null;
    try {
      lock = this.acquireWriteLock();
      return operation();
    } finally {
      try {
        if (lock) this.releaseWriteLock(lock);
      } finally {
        ACTIVE_WRITES.delete(this.filePath);
      }
    }
  }

  writeChunk(descriptor, contents, offset, length) {
    return fs.writeSync(descriptor, contents, offset, length);
  }

  writeCompleteImage(filePath, contents, mode) {
    const descriptor = fs.openSync(filePath, "wx", mode);
    try {
      let offset = 0;
      while (offset < contents.length) {
        const written = this.writeChunk(
          descriptor,
          contents,
          offset,
          contents.length - offset
        );
        if (!Number.isSafeInteger(written) || written <= 0) {
          throw new Error("incomplete ledger image write");
        }
        offset += written;
      }
      fs.fsyncSync(descriptor);
      fs.fchmodSync(descriptor, mode);
    } finally {
      fs.closeSync(descriptor);
    }
  }

  replaceLedgerImage(temporaryPath) {
    fs.renameSync(temporaryPath, this.filePath);
  }

  syncDataDirectory() {
    let descriptor;
    try {
      descriptor = fs.openSync(this.dataDirectory, "r");
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !error ||
        !["EINVAL", "EPERM", "EACCES", "ENOTSUP", "EISDIR"].includes(error.code)
      ) {
        throw error;
      }
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  appendLocked(events, recordedAtUtc, existing) {
    const validation = validateLedgerRecords(existing);
    let previousHash = validation.tailHash;
    const canonicalRecordedAtUtc = new Date(Date.parse(recordedAtUtc)).toISOString();
    const records = events.map((event, offset) => {
      const body = {
        ...event,
        sequence: existing.length + offset,
        previousHash,
        recordedAtUtc: canonicalRecordedAtUtc
      };
      const record = Object.freeze({
        ...body,
        recordHash: computeLedgerRecordHash(body)
      });
      previousHash = record.recordHash;
      return record;
    });
    const completeImage = Buffer.from(
      [...existing, ...records].map((record) => `${JSON.stringify(record)}\n`).join(""),
      "utf8"
    );
    const currentMode = fs.statSync(this.filePath).mode & 0o777;
    const temporaryPath = path.join(
      this.dataDirectory,
      `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    let replaced = false;
    try {
      this.writeCompleteImage(temporaryPath, completeImage, currentMode);
      this.replaceLedgerImage(temporaryPath);
      replaced = true;
      this.syncDataDirectory();
      const committed = this.readAll();
      const committedValidation = validateLedgerRecords(committed);
      if (
        committedValidation.length !== existing.length + records.length ||
        committedValidation.tailHash !== records.at(-1).recordHash
      ) {
        throw new Error("committed ledger image failed post-replace validation");
      }
    } finally {
      if (!replaced && fs.existsSync(temporaryPath)) {
        fs.unlinkSync(temporaryPath);
      }
    }
    return Object.freeze(records);
  }

  appendMany(events, { recordedAtUtc = new Date().toISOString() } = {}) {
    this.validateAppendRequest(events, recordedAtUtc);
    return this.withWriteLock(() => {
      const existing = this.readAll();
      return this.appendLocked(events, recordedAtUtc, existing);
    });
  }

  appendOnce(event, {
    uniqueBy,
    guard,
    recordedAtUtc = new Date().toISOString()
  } = {}) {
    const result = this.appendManyOnce([event], {
      uniqueBy,
      guard,
      recordedAtUtc
    });
    return Object.freeze({
      appended: result.appended,
      record: result.appended ? result.records[0] : result.matched
    });
  }

  appendManyOnce(events, {
    uniqueBy,
    guard,
    recordedAtUtc = new Date().toISOString()
  } = {}) {
    this.validateAppendRequest(events, recordedAtUtc);
    const uniquenessCriteria = Array.isArray(uniqueBy) ? uniqueBy : [uniqueBy];
    if (
      uniquenessCriteria.length === 0 ||
      uniquenessCriteria.some(
        (criterion) => !isPlainObject(criterion) || Object.keys(criterion).length === 0
      )
    ) {
      throw new TypeError(
        "appendManyOnce.uniqueBy must be a non-empty object or array of non-empty objects"
      );
    }
    return this.withWriteLock(() => {
      const existing = this.readAll();
      validateLedgerRecords(existing);
      const matched = existing.find((record) =>
        uniquenessCriteria.some((criterion) =>
          Object.entries(criterion).every(([field, value]) => record[field] === value)
        )
      );
      if (matched) {
        return Object.freeze({ appended: false, matched, records: Object.freeze([]) });
      }
      if (guard !== undefined) {
        if (typeof guard !== "function") throw new TypeError("appendManyOnce.guard must be a function");
        guard(Object.freeze([...existing]));
      }
      const records = this.appendLocked(events, recordedAtUtc, existing);
      return Object.freeze({ appended: true, matched: null, records });
    });
  }

  acquireWriteLock() {
    let descriptor;
    const deadline = Date.now() + LEDGER_LOCK_WAIT_MS;
    while (descriptor === undefined) {
      try {
        descriptor = fs.openSync(this.lockPath, "wx");
      } catch (error) {
        if (!error || error.code !== "EEXIST") throw error;
        if (Date.now() < deadline) {
          Atomics.wait(LOCK_WAIT_ARRAY, 0, 0, LEDGER_LOCK_RETRY_MS);
          continue;
        }
        let owner = "unreadable owner metadata";
        try {
          const parsed = JSON.parse(fs.readFileSync(this.lockPath, "utf8"));
          owner = `pid=${parsed.pid || "unknown"} host=${parsed.hostname || "unknown"} createdAtUtc=${parsed.createdAtUtc || "unknown"}`;
        } catch {
          // A malformed or partially written lock is still authoritative. Never
          // delete or steal it automatically because another process may own it.
        }
        throw new Error(
          `cross-process ledger append rejected; lock exists (${owner}); manual stale-lock recovery is required`
        );
      }
    }

    const owner = Object.freeze({
      schemaVersion: LEDGER_LOCK_SCHEMA,
      pid: process.pid,
      hostname: os.hostname(),
      createdAtUtc: new Date().toISOString(),
      ledgerPathSha256: crypto.createHash("sha256").update(this.filePath).digest("hex")
    });
    try {
      const serializedOwner = `${JSON.stringify(owner)}\n`;
      const contents = Buffer.from(serializedOwner, "utf8");
      const written = fs.writeSync(descriptor, contents, 0, contents.length);
      if (written !== contents.length) throw new Error("incomplete ledger lock metadata write");
      fs.fsyncSync(descriptor);
      return Object.freeze({ descriptor, owner, serializedOwner });
    } catch (error) {
      try { fs.closeSync(descriptor); } catch {}
      try { fs.unlinkSync(this.lockPath); } catch {}
      throw error;
    }
  }

  releaseWriteLock(lock) {
    let ownershipConfirmed = false;
    try {
      ownershipConfirmed =
        fs.readFileSync(this.lockPath, "utf8") === lock.serializedOwner;
    } catch {
      // Missing or unreadable ownership evidence must never authorize removal.
    }
    let closeError = null;
    try {
      fs.closeSync(lock.descriptor);
    } catch (error) {
      closeError = error;
    }
    if (!ownershipConfirmed) {
      throw new Error("ledger lock ownership changed; refusing automatic lock removal");
    }
    try {
      fs.unlinkSync(this.lockPath);
    } catch (error) {
      throw new Error(`ledger write completed but lock release failed: ${error.message}`);
    }
    if (closeError) throw closeError;
  }

  readAll() {
    const contents = fs.readFileSync(this.filePath, "utf8");
    if (!contents.trim()) return [];
    return contents.trimEnd().split("\n").map((line, index) => {
      try { return JSON.parse(line); } catch { throw new Error(`Invalid JSONL ledger record at line ${index + 1}`); }
    });
  }
}

module.exports = {
  ControlLedger,
  LEDGER_FILE,
  LEDGER_LOCK_SCHEMA,
  LEDGER_LOCK_WAIT_MS,
  computeLedgerRecordHash,
  resolveDataDirectory,
  stableStringify,
  validateLedgerRecords
};
