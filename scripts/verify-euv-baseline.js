"use strict";

// Verifies an in-memory baseline against explicitly supplied, confirmed roots.
// It does not write a manifest and does not run build or test commands.
const { buildBaseline } = require("./euv-baseline-manifest");

function verifyBaseline(baseline, inputs) {
  if (!baseline || baseline.schemaVersion !== 1) throw new TypeError("unsupported baseline manifest");
  const current = buildBaseline(inputs);
  const failures = [];
  if (baseline.expectedMarkers.build !== current.expectedMarkers.build) failures.push("build marker differs");
  if (baseline.expectedMarkers.test !== current.expectedMarkers.test) failures.push("test marker differs");
  if (JSON.stringify(baseline.modManifest) !== JSON.stringify(current.modManifest)) failures.push("mod manifest differs");
  if (JSON.stringify(baseline.saveInventory) !== JSON.stringify(current.saveInventory)) failures.push("save inventory differs");
  if (JSON.stringify(baseline.modInventory) !== JSON.stringify(current.modInventory)) failures.push("mod inventory differs");
  return { verified: failures.length === 0, readOnly: true, failures };
}

module.exports = { verifyBaseline };
