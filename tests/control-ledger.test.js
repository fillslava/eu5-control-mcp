"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  ControlLedger,
  validateLedgerRecords
} = require("../src/control/control-ledger");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-ledger-chain-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new ControlLedger({ dataDirectory: directory });
}

test("ledger validates and extends one hash chain across instances", (t) => {
  const first = fixture(t);
  first.append({ type: "first" }, { recordedAtUtc: "2026-07-26T10:00:00.000Z" });
  const second = new ControlLedger({ dataDirectory: first.dataDirectory });
  second.append({ type: "second" }, { recordedAtUtc: "2026-07-26T10:00:01.000Z" });
  const records = first.readAll();
  assert.equal(validateLedgerRecords(records).valid, true);
  assert.equal(records[1].previousHash, records[0].recordHash);
});

test("ledger refuses to append after tail corruption", (t) => {
  const ledger = fixture(t);
  ledger.append({ type: "first" }, { recordedAtUtc: "2026-07-26T10:00:00.000Z" });
  const [record] = ledger.readAll();
  record.type = "tampered";
  fs.writeFileSync(ledger.filePath, `${JSON.stringify(record)}\n`, "utf8");
  assert.throws(
    () => ledger.append({ type: "second" }),
    /Invalid ledger recordHash/
  );
  assert.equal(ledger.readAll().length, 1);
});

test("multi-record append is contiguous and durable as one transition batch", (t) => {
  const ledger = fixture(t);
  const records = ledger.appendMany(
    [{ type: "gated" }, { type: "confirmed" }, { type: "authorized" }],
    { recordedAtUtc: "2026-07-26T10:00:00.000Z" }
  );
  assert.deepEqual(records.map((record) => record.sequence), [0, 1, 2]);
  assert.equal(records[1].previousHash, records[0].recordHash);
  assert.equal(records[2].previousHash, records[1].recordHash);
  assert.equal(ledger.validate().valid, true);
});

test("atomic append can enforce multiple uniqueness boundaries", (t) => {
  const ledger = fixture(t);
  const first = ledger.appendOnce(
    { type: "authorized", declarationId: "declaration-1", approvalId: "approval-1" },
    {
      uniqueBy: [
        { type: "authorized", declarationId: "declaration-1" },
        { type: "authorized", approvalId: "approval-1" }
      ]
    }
  );
  assert.equal(first.appended, true);
  const sameDeclaration = ledger.appendOnce(
    { type: "authorized", declarationId: "declaration-1", approvalId: "approval-2" },
    {
      uniqueBy: [
        { type: "authorized", declarationId: "declaration-1" },
        { type: "authorized", approvalId: "approval-2" }
      ]
    }
  );
  assert.equal(sameDeclaration.appended, false);
  assert.equal(sameDeclaration.record.approvalId, "approval-1");
  const reusedApproval = ledger.appendOnce(
    { type: "authorized", declarationId: "declaration-2", approvalId: "approval-1" },
    {
      uniqueBy: [
        { type: "authorized", declarationId: "declaration-2" },
        { type: "authorized", approvalId: "approval-1" }
      ]
    }
  );
  assert.equal(reusedApproval.appended, false);
  assert.equal(reusedApproval.record.declarationId, "declaration-1");
  assert.equal(ledger.readAll().length, 1);
});

test("a concurrent process lock excludes writers and is never stolen as stale", async (t) => {
  const ledger = fixture(t);
  const childScript = [
    "const fs=require('node:fs');",
    "const lock=process.argv[1];",
    "const fd=fs.openSync(lock,'wx');",
    "fs.writeSync(fd,JSON.stringify({schemaVersion:'eu5.control-ledger-lock/v1',pid:process.pid,hostname:'child',createdAtUtc:'2000-01-01T00:00:00.000Z'})+'\\n');",
    "fs.fsyncSync(fd);",
    "process.stdout.write('ready\\n');",
    "process.on('message',(message)=>{if(message==='release'){fs.closeSync(fd);fs.unlinkSync(lock);process.exit(0);}});"
  ].join("");
  const child = spawn(process.execPath, ["-e", childScript, ledger.lockPath], {
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  t.after(() => {
    if (!child.killed) child.kill();
    if (fs.existsSync(ledger.lockPath)) fs.unlinkSync(ledger.lockPath);
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("child lock process did not become ready")), 5_000);
    child.once("error", reject);
    child.stdout.once("data", (chunk) => {
      clearTimeout(timeout);
      assert.match(chunk.toString(), /ready/);
      resolve();
    });
  });

  assert.throws(
    () => ledger.append({ type: "blocked" }),
    /cross-process ledger append rejected.*manual stale-lock recovery is required/
  );
  assert.equal(ledger.readAll().length, 0);

  child.send("release");
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`child exited ${code}`)));
  });
  ledger.append({ type: "after-release" });
  assert.equal(ledger.readAll().length, 1);
});

test("changed lock ownership fails release without deleting the new owner's lock", (t) => {
  class OwnershipSwappingLedger extends ControlLedger {
    releaseWriteLock(lock) {
      fs.writeFileSync(
        this.lockPath,
        `${JSON.stringify({
          schemaVersion: "eu5.control-ledger-lock/v1",
          pid: 999_999,
          hostname: "replacement-owner",
          createdAtUtc: "2026-07-26T10:00:00.000Z"
        })}\n`,
        "utf8"
      );
      return super.releaseWriteLock(lock);
    }
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-ledger-owner-swap-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = new OwnershipSwappingLedger({ dataDirectory: directory });
  assert.throws(
    () => ledger.append({ type: "written-before-release-failure" }),
    /lock ownership changed/
  );
  assert.equal(ledger.readAll().length, 1);
  assert.equal(fs.existsSync(ledger.lockPath), true);
  assert.match(fs.readFileSync(ledger.lockPath, "utf8"), /replacement-owner/);

  fs.unlinkSync(ledger.lockPath);
  ledger.releaseWriteLock = ControlLedger.prototype.releaseWriteLock.bind(ledger);
  ledger.append({ type: "after-manual-owner-recovery" });
  assert.equal(ledger.readAll().length, 2);
});
