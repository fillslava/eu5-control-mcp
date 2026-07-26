"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ControlLedger,
  LEDGER_FILE,
  validateLedgerRecords
} = require("../src/control/control-ledger");

function fixture(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-ledger-atomic-"));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const ledger = new ControlLedger({ dataDirectory });
  ledger.append(
    { type: "baseline", actionId: "baseline-action" },
    { recordedAtUtc: "2026-07-26T10:00:00.000Z" }
  );
  return { dataDirectory, ledger };
}

function ledgerBytes(dataDirectory) {
  return fs.readFileSync(path.join(dataDirectory, LEDGER_FILE));
}

function nonLedgerArtifacts(dataDirectory) {
  return fs.readdirSync(dataDirectory)
    .filter((name) => name !== LEDGER_FILE && name !== `${LEDGER_FILE}.lock`)
    .sort();
}

function assertOriginalUnchangedAndValid(ledger, expectedBytes) {
  assert.deepEqual(
    fs.readFileSync(ledger.filePath),
    expectedBytes,
    "a failed replacement must leave the original ledger byte-identical"
  );
  const records = ledger.readAll();
  assert.equal(records.length, 1);
  assert.equal(validateLedgerRecords(records).valid, true);
}

function assertHealthyAppendExtendsChain(dataDirectory) {
  const recovered = new ControlLedger({ dataDirectory });
  recovered.append(
    { type: "after-failure", actionId: "recovery-action" },
    { recordedAtUtc: "2026-07-26T10:00:01.000Z" }
  );
  const records = recovered.readAll();
  const validation = validateLedgerRecords(records);
  assert.equal(validation.valid, true);
  assert.equal(records.length, 2);
  assert.equal(records[1].sequence, 1);
  assert.equal(records[1].previousHash, records[0].recordHash);
  assert.equal(validation.tailHash, records[1].recordHash);
}

test("incomplete temp-file write before rename preserves original bytes and complete chain", (t) => {
  const { dataDirectory, ledger } = fixture(t);
  const before = ledgerBytes(dataDirectory);
  class IncompleteWriteLedger extends ControlLedger {
    constructor(options) {
      super(options);
      this.writeCalls = 0;
      this.renameCalled = false;
    }

    writeChunk(descriptor, contents, offset, length) {
      this.writeCalls += 1;
      if (this.writeCalls === 1) {
        const shortLength = Math.max(1, length - 1);
        return super.writeChunk(descriptor, contents, offset, shortLength);
      }
      return 0;
    }

    replaceLedgerImage(temporaryPath) {
      this.renameCalled = true;
      return super.replaceLedgerImage(temporaryPath);
    }
  }
  const failing = new IncompleteWriteLedger({ dataDirectory });

  assert.throws(
    () => failing.append(
      { type: "must-not-land", actionId: "short-write" },
      { recordedAtUtc: "2026-07-26T10:00:01.000Z" }
    ),
    /incomplete|short|atomic ledger/i
  );
  assert.equal(failing.writeCalls, 2, "the replacement writer must observe a short write");
  assert.equal(failing.renameCalled, false, "an incomplete replacement must never be renamed into place");
  assertOriginalUnchangedAndValid(ledger, before);
  assert.deepEqual(nonLedgerArtifacts(dataDirectory), [], "failed temp files must be cleaned");

  assertHealthyAppendExtendsChain(dataDirectory);
});

test("rename failure preserves original bytes, cleans the temp, and permits a later append", (t) => {
  const { dataDirectory, ledger } = fixture(t);
  const before = ledgerBytes(dataDirectory);
  class RenameFailureLedger extends ControlLedger {
    constructor(options) {
      super(options);
      this.replacementPath = null;
      this.renameInjected = false;
    }

    replaceLedgerImage(temporaryPath) {
      this.replacementPath = temporaryPath;
      this.renameInjected = true;
      const error = new Error("injected atomic rename failure");
      error.code = "EACCES";
      throw error;
    }
  }
  const failing = new RenameFailureLedger({ dataDirectory });

  assert.throws(
    () => failing.append(
      { type: "must-not-land", actionId: "rename-failure" },
      { recordedAtUtc: "2026-07-26T10:00:01.000Z" }
    ),
    /injected atomic rename failure/
  );
  assert.equal(failing.renameInjected, true, "the rename fault must be exercised");
  assert.equal(
    failing.replacementPath === null || fs.existsSync(failing.replacementPath),
    false,
    "the failed replacement temp must be removed"
  );
  assertOriginalUnchangedAndValid(ledger, before);
  assert.deepEqual(nonLedgerArtifacts(dataDirectory), []);

  assertHealthyAppendExtendsChain(dataDirectory);
});
