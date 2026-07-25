"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Return a metadata-only inventory of EU5 saves. The caller must confirm the
 * exact directory; this avoids guessing or scanning a user's Documents tree.
 */
function resolveDirectory(input, label) {
  if (!path.isAbsolute(input)) throw new TypeError(`${label} must be an absolute path`);
  const stat = fs.lstatSync(input);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError(`${label} must be a real directory`);
  }
  return fs.realpathSync.native(input);
}

function listSaveCheckpoints({ saveDirectory, confirmedSaveDirectory, includeSubfolders = false, extensions = [".eu5"] }) {
  const root = resolveDirectory(saveDirectory, "saveDirectory");
  const confirmedRoot = resolveDirectory(confirmedSaveDirectory, "confirmedSaveDirectory");
  if (root.toLowerCase() !== confirmedRoot.toLowerCase()) {
    throw new TypeError("saveDirectory must match confirmedSaveDirectory");
  }
  const allowed = new Set(extensions.map((extension) => {
    if (typeof extension !== "string" || !/^\.[a-z0-9]+$/i.test(extension)) {
      throw new TypeError("extensions must contain simple dot-prefixed values");
    }
    return extension.toLowerCase();
  }));
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory() && includeSubfolders) visit(fullPath);
      if (!entry.isFile() || !allowed.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = fs.statSync(fullPath);
      files.push({
        relativePath: path.relative(root, fullPath),
        bytes: stat.size,
        lastWriteTimeUtc: stat.mtime.toISOString(),
        sha256: crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex")
      });
    }
  };
  visit(root);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    saveDirectory: root,
    scope: includeSubfolders ? "recursive" : "direct-children",
    extensions: [...allowed].sort(),
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files
  };
}

module.exports = { listSaveCheckpoints };
