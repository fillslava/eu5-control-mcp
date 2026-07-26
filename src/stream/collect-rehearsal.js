#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  COLLECTOR_LIMITS,
  StreamRehearsalCollector
} = require("./rehearsal-collector");
const {
  MAXIMUM_INPUT_BYTES,
  readBoundedUtf8
} = require("./verify-rehearsal");

const CAPTURE_SCHEMA = "eu5.stream-rehearsal-capture/v1";

function usage() {
  return [
    "Usage:",
    "  node src/stream/collect-rehearsal.js --feeds <feed.json|feeds.jsonl> --session <capture.json> --output <bundle.json>",
    "",
    "The feed input may be one eu5.monitoring-feed/v1 object, a JSON array of",
    "feed snapshots, or JSONL with one snapshot per line. The command only",
    "reads monitoring artifacts and exclusively creates a new JSON bundle."
  ].join("\n");
}

function parseArguments(argv) {
  const args = {};
  if (argv.length % 2 !== 0) throw new Error(usage());
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--feeds", "--session", "--output"].includes(key) || !value) {
      throw new Error(usage());
    }
    const name = key.slice(2);
    if (args[name]) throw new Error(`${key} may only be supplied once`);
    args[name] = value;
  }
  for (const required of ["feeds", "session", "output"]) {
    if (!args[required]) throw new Error(usage());
  }
  return args;
}

function rejectAlternateDataStream(resolved, label) {
  const pathWithoutRoot = resolved.slice(path.parse(resolved).root.length);
  if (pathWithoutRoot.includes(":")) {
    throw new Error(`${label} must not use a Windows alternate data stream`);
  }
}

function resolveInput(inputPath, extensions, label) {
  const resolved = path.resolve(inputPath);
  rejectAlternateDataStream(resolved, label);
  if (!extensions.includes(path.extname(resolved).toLowerCase())) {
    throw new Error(`${label} must be ${extensions.join(" or ")}`);
  }
  const stats = fs.lstatSync(resolved);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return resolved;
}

function readBoundedText(resolved, label) {
  return readBoundedUtf8(resolved, label);
}

function readJsonFile(resolved, label) {
  try {
    return JSON.parse(readBoundedText(resolved, label));
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

function readFeedSnapshots(resolved) {
  const contents = readBoundedText(resolved, "feed snapshots");
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    parsed = contents.trim().split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid feed JSON at line ${index + 1}: ${error.message}`);
      }
    });
  }
  const feeds = Array.isArray(parsed) ? parsed : [parsed];
  if (feeds.length === 0) throw new Error("feed snapshots must not be empty");
  if (feeds.length > COLLECTOR_LIMITS.maximumFeeds) {
    throw new Error(
      `feed snapshots are limited to ${COLLECTOR_LIMITS.maximumFeeds} entries`
    );
  }
  return feeds;
}

function validateCapture(capture) {
  if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
    throw new TypeError("capture session must be an object");
  }
  if (capture.schemaVersion !== CAPTURE_SCHEMA) {
    throw new TypeError(`capture session schemaVersion must be ${CAPTURE_SCHEMA}`);
  }
  if (
    capture.boundedAdvances !== undefined &&
    !Array.isArray(capture.boundedAdvances)
  ) {
    throw new TypeError("capture session boundedAdvances must be an array");
  }
  if (
    (capture.boundedAdvances || []).length >
    COLLECTOR_LIMITS.maximumBoundedAdvances
  ) {
    throw new TypeError(
      `capture session is limited to ${COLLECTOR_LIMITS.maximumBoundedAdvances} bounded advances`
    );
  }
  return capture;
}

function buildBundle(feeds, capture) {
  const accepted = validateCapture(capture);
  const collector = new StreamRehearsalCollector({
    rehearsalId: accepted.rehearsalId,
    fingerprint: accepted.fingerprint,
    fingerprintEvidenceSha256: accepted.fingerprintEvidenceSha256,
    startedAtUtc: accepted.startedAtUtc
  });
  for (const feed of feeds) collector.ingest(feed);
  for (const advance of accepted.boundedAdvances || []) {
    collector.recordBoundedAdvance(advance);
  }
  return collector.complete(accepted.completedAtUtc);
}

function writeBundle(outputPath, bundle, protectedPaths) {
  const resolved = path.resolve(outputPath);
  rejectAlternateDataStream(resolved, "bundle output");
  if (path.extname(resolved).toLowerCase() !== ".json") {
    throw new Error("bundle output must be a new .json file");
  }
  const protectedResolved = new Set(
    protectedPaths.map((item) => path.resolve(item).toLowerCase())
  );
  if (protectedResolved.has(resolved.toLowerCase())) {
    throw new Error("bundle output must not alias an input artifact");
  }
  fs.writeFileSync(
    resolved,
    `${JSON.stringify(bundle, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" }
  );
  return resolved;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const feedsPath = resolveInput(args.feeds, [".json", ".jsonl"], "feed input");
  const sessionPath = resolveInput(args.session, [".json"], "capture session");
  const bundle = buildBundle(
    readFeedSnapshots(feedsPath),
    readJsonFile(sessionPath, "capture session")
  );
  const output = writeBundle(args.output, bundle, [feedsPath, sessionPath]);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: bundle.schemaVersion,
    bundleId: bundle.bundleId,
    records: bundle.records.length,
    output
  })}\n`);
  return bundle;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CAPTURE_SCHEMA,
  MAXIMUM_INPUT_BYTES,
  buildBundle,
  main,
  parseArguments,
  readFeedSnapshots,
  resolveInput,
  usage,
  validateCapture,
  writeBundle
};
