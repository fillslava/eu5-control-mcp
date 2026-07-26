"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEBUG_EXPORT_SCOPES = Object.freeze([
  Object.freeze({
    pattern: "console.txt",
    relativeDirectory: "",
    exactName: "console.txt"
  }),
  Object.freeze({
    pattern: "docs/*.log",
    relativeDirectory: "docs",
    extension: ".log"
  }),
  Object.freeze({
    pattern: "logs/data_types/*.txt",
    relativeDirectory: path.join("logs", "data_types"),
    extension: ".txt"
  })
]);

function defaultUserDirectory() {
  return process.env.EU5_USER_DIRECTORY || path.join(
    os.homedir(),
    "Documents",
    "Paradox Interactive",
    "Europa Universalis V"
  );
}

function lstatIfPresent(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function entryType(stat) {
  if (!stat) return "missing";
  if (stat.isSymbolicLink()) return "symbolic_link";
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  return "other";
}

function fileMetadata(root, fullPath, stat) {
  return {
    path: fullPath,
    relativePath: path.relative(root, fullPath),
    exists: true,
    bytes: stat.size,
    lastWriteTimeUtc: stat.mtime.toISOString()
  };
}

function inspectExactFile(root, scope) {
  const fullPath = path.join(root, scope.exactName);
  const stat = lstatIfPresent(fullPath);
  const type = entryType(stat);
  const files = type === "file" ? [fileMetadata(root, fullPath, stat)] : [];

  return {
    pattern: scope.pattern,
    path: fullPath,
    exists: Boolean(stat),
    entryType: type,
    matchedFileCount: files.length,
    files
  };
}

function inspectDirectoryPattern(root, scope) {
  const directoryPath = path.join(root, scope.relativeDirectory);
  const directoryStat = lstatIfPresent(directoryPath);
  const type = entryType(directoryStat);
  const files = [];

  if (type === "directory") {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      if (
        !entry.isFile() ||
        path.extname(entry.name).toLowerCase() !== scope.extension
      ) {
        continue;
      }
      const fullPath = path.join(directoryPath, entry.name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isFile() && !stat.isSymbolicLink()) {
        files.push(fileMetadata(root, fullPath, stat));
      }
    }
  }

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    pattern: scope.pattern,
    path: path.join(directoryPath, `*${scope.extension}`),
    exists: files.length > 0,
    directoryPath,
    directoryExists: Boolean(directoryStat),
    directoryEntryType: type,
    matchedFileCount: files.length,
    files
  };
}

function listDebugExports({ userDirectory = defaultUserDirectory() } = {}) {
  if (!path.isAbsolute(userDirectory)) {
    throw new TypeError("userDirectory must be an absolute path");
  }

  const rootStat = lstatIfPresent(userDirectory);
  if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) {
    throw new TypeError("userDirectory must be a real directory when it exists");
  }

  const root = rootStat ? fs.realpathSync.native(userDirectory) : path.resolve(userDirectory);
  const scopes = DEBUG_EXPORT_SCOPES.map((scope) => (
    scope.exactName
      ? inspectExactFile(root, scope)
      : inspectDirectoryPattern(root, scope)
  ));
  const files = scopes.flatMap((scope) => scope.files)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    schemaVersion: 1,
    observedAtUtc: new Date().toISOString(),
    userDirectory: root,
    userDirectoryExists: Boolean(rootStat),
    readOnly: true,
    contentIncluded: false,
    patterns: DEBUG_EXPORT_SCOPES.map((scope) => scope.pattern),
    matchedFileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    scopes,
    files
  };
}

module.exports = {
  DEBUG_EXPORT_SCOPES,
  defaultUserDirectory,
  listDebugExports
};
