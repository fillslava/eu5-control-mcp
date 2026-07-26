"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  defaultUserDirectory,
  listDebugExports
} = require("../src/read/debug-export-inventory");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-debug-exports-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(root, "docs"));
  fs.mkdirSync(path.join(root, "logs", "data_types"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "nested"));
  fs.writeFileSync(path.join(root, "console.txt"), "secret console output");
  fs.writeFileSync(path.join(root, "docs", "game.log"), "secret game log");
  fs.writeFileSync(path.join(root, "docs", "ignore.txt"), "ignore");
  fs.writeFileSync(path.join(root, "docs", "nested", "nested.log"), "ignore");
  fs.writeFileSync(path.join(root, "logs", "data_types", "types.txt"), "secret types");
  fs.writeFileSync(path.join(root, "logs", "data_types", "ignore.log"), "ignore");

  return root;
}

test("debug-export inventory is fixed-scope, metadata-only, and non-recursive", (t) => {
  const root = fixture(t);
  const result = listDebugExports({ userDirectory: root });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.readOnly, true);
  assert.equal(result.contentIncluded, false);
  assert.deepEqual(result.patterns, [
    "console.txt",
    "docs/*.log",
    "logs/data_types/*.txt"
  ]);
  assert.equal(result.matchedFileCount, 3);
  assert.deepEqual(
    result.files.map((file) => file.relativePath),
    [
      "console.txt",
      path.join("docs", "game.log"),
      path.join("logs", "data_types", "types.txt")
    ].sort((left, right) => left.localeCompare(right))
  );
  assert.deepEqual(
    Object.keys(result.files[0]).sort(),
    ["bytes", "exists", "lastWriteTimeUtc", "path", "relativePath"].sort()
  );
  assert.doesNotMatch(JSON.stringify(result), /secret (console output|game log|types)/);
});

test("debug-export inventory reports missing fixed locations without failing", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-debug-missing-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const missingRoot = path.join(parent, "missing");

  const result = listDebugExports({ userDirectory: missingRoot });

  assert.equal(result.userDirectoryExists, false);
  assert.equal(result.matchedFileCount, 0);
  assert.equal(result.totalBytes, 0);
  assert.equal(result.scopes.length, 3);
  assert.ok(result.scopes.every((scope) => scope.exists === false));
});

test("debug-export inventory rejects relative and symbolic-link roots", (t) => {
  assert.throws(
    () => listDebugExports({ userDirectory: "." }),
    /absolute path/
  );

  const root = fixture(t);
  const link = path.join(path.dirname(root), `${path.basename(root)}-link`);
  try {
    fs.symlinkSync(root, link, "junction");
  } catch (error) {
    if (error.code === "EPERM") return;
    throw error;
  }
  t.after(() => fs.rmSync(link, { force: true }));

  assert.throws(
    () => listDebugExports({ userDirectory: link }),
    /real directory/
  );
});

test("default user directory follows the Windows user profile", () => {
  const original = process.env.EU5_USER_DIRECTORY;
  delete process.env.EU5_USER_DIRECTORY;
  try {
    assert.equal(
      defaultUserDirectory(),
      path.join(
        os.homedir(),
        "Documents",
        "Paradox Interactive",
        "Europa Universalis V"
      )
    );
  } finally {
    if (original !== undefined) process.env.EU5_USER_DIRECTORY = original;
  }
});

test("EU5_USER_DIRECTORY overrides the standard user directory", () => {
  const original = process.env.EU5_USER_DIRECTORY;
  process.env.EU5_USER_DIRECTORY = "D:\\custom-eu5-user";
  try {
    assert.equal(defaultUserDirectory(), "D:\\custom-eu5-user");
  } finally {
    if (original === undefined) delete process.env.EU5_USER_DIRECTORY;
    else process.env.EU5_USER_DIRECTORY = original;
  }
});
