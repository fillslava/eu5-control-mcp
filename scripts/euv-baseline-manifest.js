"use strict";

// Read-only baseline evidence builder.  It intentionally hashes save bytes but
// never attempts to interpret the save format or create any files.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;

function realDirectory(input, label) {
  if (typeof input !== "string" || !path.isAbsolute(input)) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  const stat = fs.lstatSync(input);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError(`${label} must be a real directory, not a link`);
  }
  return fs.realpathSync.native(input);
}

function assertConfirmed(actual, confirmed, label) {
  const root = realDirectory(actual, label);
  const confirmation = realDirectory(confirmed, `confirmed${label[0].toUpperCase()}${label.slice(1)}`);
  if (root.toLowerCase() !== confirmation.toLowerCase()) {
    throw new TypeError(`${label} must match its user-confirmed directory`);
  }
  return root;
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function relativePosix(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError("encountered a path outside the confirmed root");
  }
  return relative.split(path.sep).join("/");
}

function inventory(root, { extensions } = {}) {
  const allowed = extensions && new Set(extensions.map((value) => value.toLowerCase()));
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      if (!entry.isFile() || (allowed && !allowed.has(path.extname(entry.name).toLowerCase()))) continue;
      const stat = fs.statSync(file);
      files.push({
        relativePath: relativePosix(root, file),
        bytes: stat.size,
        sha256: sha256(file)
      });
    }
  };
  visit(root);
  files.sort((left, right) => left.relativePath.localeCompare(right));
  return files;
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function loadModManifest(modRoot) {
  const manifestPath = path.join(modRoot, ".metadata", "metadata.json");
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError("mod manifest must be a regular file");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new TypeError("mod manifest must contain valid JSON");
  }
  for (const key of ["id", "version", "supported_game_version"]) nonEmpty(manifest[key], `mod manifest ${key}`);
  return { relativePath: ".metadata/metadata.json", sha256: sha256(manifestPath), identity: {
    id: manifest.id, version: manifest.version, supportedGameVersion: manifest.supported_game_version
  }};
}

function buildBaseline({ saveDirectory, confirmedSaveDirectory, modDirectory, confirmedModDirectory, buildMarker, testMarker } = {}) {
  const saves = assertConfirmed(saveDirectory, confirmedSaveDirectory, "saveDirectory");
  const mod = assertConfirmed(modDirectory, confirmedModDirectory, "modDirectory");
  const saveFiles = inventory(saves, { extensions: [".eu5"] });
  const modFiles = inventory(mod);
  const modManifest = loadModManifest(mod);
  return {
    schemaVersion: SCHEMA_VERSION,
    readOnly: true,
    saveParsing: "not-performed",
    paths: { saves: "<confirmed-save-root>", mod: "<confirmed-mod-root>" },
    saveInventory: { extensions: [".eu5"], fileCount: saveFiles.length, totalBytes: saveFiles.reduce((sum, file) => sum + file.bytes, 0), files: saveFiles },
    modInventory: { fileCount: modFiles.length, totalBytes: modFiles.reduce((sum, file) => sum + file.bytes, 0), files: modFiles },
    modManifest,
    expectedMarkers: { build: nonEmpty(buildMarker, "buildMarker"), test: nonEmpty(testMarker, "testMarker") }
  };
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key.startsWith("--") || args[index + 1] === undefined) throw new TypeError("expected --name value pairs");
    parsed[key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = args[index + 1];
  }
  return parsed;
}

if (require.main === module) {
  try {
    const result = buildBaseline(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Baseline not created: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { buildBaseline, inventory, sha256 };
