"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Return a metadata-only inventory of EU5 save files. This intentionally does
 * not parse or mutate save contents; parsing is a later, fixture-tested step.
 */
function listSaveCheckpoints(saveDirectory) {
  const root = path.resolve(saveDirectory);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".eu5"))
    .map((entry) => {
      const filePath = path.join(root, entry.name);
      const stat = fs.statSync(filePath);
      const hash = crypto.createHash("sha256")
        .update(fs.readFileSync(filePath))
        .digest("hex");
      return {
        name: entry.name,
        path: filePath,
        bytes: stat.size,
        modifiedUtc: stat.mtime.toISOString(),
        sha256: hash
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { listSaveCheckpoints };
