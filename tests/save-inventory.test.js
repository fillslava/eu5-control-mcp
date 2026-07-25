"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { defaultSaveDirectory, listSaveCheckpoints } = require("../src/read/save-inventory");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-mcp-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "b.eu5"), "bb");
  fs.writeFileSync(path.join(root, "A.EU5"), "aaa");
  fs.writeFileSync(path.join(root, "skip.txt"), "x");
  fs.mkdirSync(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "nested", "c.eu5"), "ccc");
  return root;
}

test("inventory is metadata-only, deterministic, and direct by default", (t) => {
  const root = fixture(t);
  const result = listSaveCheckpoints({ saveDirectory: root, confirmedSaveDirectory: root });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.scope, "direct-children");
  assert.equal(result.fileCount, 2);
  assert.equal(result.totalBytes, 5);
  assert.deepEqual(result.files.map((file) => file.relativePath), ["A.EU5", "b.eu5"]);
});

test("inventory rejects an unconfirmed or relative directory", (t) => {
  const root = fixture(t);
  assert.throws(() => listSaveCheckpoints({ saveDirectory: root, confirmedSaveDirectory: path.dirname(root) }));
  assert.throws(() => listSaveCheckpoints({ saveDirectory: ".", confirmedSaveDirectory: "." }));
});

test("recursive inventory is explicit", (t) => {
  const root = fixture(t);
  const result = listSaveCheckpoints({ saveDirectory: root, confirmedSaveDirectory: root, includeSubfolders: true });
  assert.equal(result.fileCount, 3);
  assert.equal(result.files.at(-1).relativePath, path.join("nested", "c.eu5"));
});

test("default save directory follows the current Windows user profile", () => {
  assert.equal(
    defaultSaveDirectory(),
    path.join(os.homedir(), "Documents", "Paradox Interactive", "Europa Universalis V", "save games")
  );
});

test("EU5_SAVE_DIRECTORY overrides the standard save directory", () => {
  const original = process.env.EU5_SAVE_DIRECTORY;
  process.env.EU5_SAVE_DIRECTORY = "D:\\custom-eu5-saves";
  try {
    assert.equal(defaultSaveDirectory(), "D:\\custom-eu5-saves");
  } finally {
    if (original === undefined) delete process.env.EU5_SAVE_DIRECTORY;
    else process.env.EU5_SAVE_DIRECTORY = original;
  }
});
