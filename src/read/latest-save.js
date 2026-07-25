"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultSaveDirectory } = require("./save-inventory");

function latestSaveCheckpoint(saveDirectory = defaultSaveDirectory()) {
  if (!path.isAbsolute(saveDirectory)) throw new TypeError("saveDirectory must be an absolute path");
  const root = fs.realpathSync.native(saveDirectory);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const saves = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".eu5"))
    .map((entry) => {
      const fullPath = path.join(root, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        relativePath: entry.name,
        bytes: stat.size,
        lastWriteTimeUtc: stat.mtime.toISOString()
      };
    })
    .sort((left, right) => {
      const timeDelta = Date.parse(right.lastWriteTimeUtc) - Date.parse(left.lastWriteTimeUtc);
      return timeDelta || left.relativePath.localeCompare(right.relativePath);
    });
  return {
    schemaVersion: 1,
    observedAtUtc: new Date().toISOString(),
    saveDirectory: root,
    fileCount: saves.length,
    latest: saves[0] ?? null,
    note: "Metadata-only fast observation; use eu5_list_save_checkpoints for SHA-256 inventory."
  };
}

module.exports = { latestSaveCheckpoint };
