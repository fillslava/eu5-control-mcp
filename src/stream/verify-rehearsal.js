#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  evaluateStreamReadiness,
  formatStreamReadinessMarkdown
} = require("./rehearsal-acceptance");

const MAXIMUM_INPUT_BYTES = 16 * 1024 * 1024;

function usage() {
  return [
    "Usage:",
    "  node src/stream/verify-rehearsal.js --bundle <bundle.json> --ledger <ledger.jsonl> --expectations <expectations.json> [--output <report.md|report.json>]",
    "",
    "This command only reads artifacts. It never controls EU5, edits saves, or invokes the console."
  ].join("\n");
}

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--bundle", "--ledger", "--expectations", "--output"].includes(key) || !value) {
      throw new Error(usage());
    }
    args[key.slice(2)] = value;
  }
  for (const required of ["bundle", "ledger", "expectations"]) {
    if (!args[required]) throw new Error(usage());
  }
  return args;
}

function readBoundedUtf8(filePath, label) {
  const resolved = path.resolve(filePath);
  const pathWithoutRoot = resolved.slice(path.parse(resolved).root.length);
  if (pathWithoutRoot.includes(":")) {
    throw new Error(`${label} input must not use a Windows alternate data stream`);
  }
  let descriptor;
  try {
    const linkStats = fs.lstatSync(resolved);
    if (linkStats.isSymbolicLink() || !linkStats.isFile()) {
      throw new Error("input must be a regular non-symlink file");
    }
    descriptor = fs.openSync(
      resolved,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    );
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile()) throw new Error("input must be a regular file");
    if (linkStats.dev !== stats.dev || linkStats.ino !== stats.ino) {
      throw new Error("input changed while it was being opened");
    }
    if (stats.size > MAXIMUM_INPUT_BYTES) {
      throw new Error(`input exceeds the ${MAXIMUM_INPUT_BYTES}-byte limit`);
    }
    const chunks = [];
    let totalBytes = 0;
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const bytesRead = fs.readSync(
        descriptor,
        buffer,
        0,
        buffer.length,
        null
      );
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > MAXIMUM_INPUT_BYTES) {
        throw new Error(`input exceeds the ${MAXIMUM_INPUT_BYTES}-byte limit`);
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readBoundedUtf8(filePath, label));
  } catch (error) {
    if (error.message.startsWith(`Cannot read ${label}:`)) throw error;
    throw new Error(`Cannot read ${label}: ${error.message}`);
  }
}

function readLedger(filePath) {
  const contents = readBoundedUtf8(filePath, "control ledger");
  if (!contents.trim()) return [];
  const trimmed = contents.trim();
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return trimmed.split(/\r?\n/).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid ledger JSON at line ${index + 1}: ${error.message}`);
    }
  });
}

function writeReport(outputPath, report, protectedPaths = []) {
  const resolved = path.resolve(outputPath);
  const extension = path.extname(resolved).toLowerCase();
  if (![".md", ".json"].includes(extension)) {
    throw new Error("Report output must be a new .md or .json file");
  }
  const pathWithoutRoot = resolved.slice(path.parse(resolved).root.length);
  if (pathWithoutRoot.includes(":")) {
    throw new Error("Report output must not use a Windows alternate data stream");
  }
  const protectedResolved = new Set(protectedPaths.map((item) => path.resolve(item).toLowerCase()));
  if (protectedResolved.has(resolved.toLowerCase())) {
    throw new Error("Report output must not alias an input artifact");
  }
  const contents = extension === ".json"
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatStreamReadinessMarkdown(report);
  fs.writeFileSync(resolved, contents, { encoding: "utf8", flag: "wx" });
  return resolved;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const report = evaluateStreamReadiness({
    bundle: readJson(args.bundle, "monitoring bundle"),
    ledger: readLedger(args.ledger),
    expectations: readJson(args.expectations, "expectations")
  });
  if (args.output) {
    writeReport(args.output, report, [args.bundle, args.ledger, args.expectations]);
  }
  process.stdout.write(formatStreamReadinessMarkdown(report));
  process.exitCode = report.verdict === "stream_ready" ? 0 : 2;
  return report;
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
  MAXIMUM_INPUT_BYTES,
  main,
  parseArguments,
  readBoundedUtf8,
  readJson,
  readLedger,
  usage,
  writeReport
};
