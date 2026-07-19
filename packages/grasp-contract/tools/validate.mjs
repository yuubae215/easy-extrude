#!/usr/bin/env node
// Validate a wire instance against one of the canonical contract schemas.
//
//   npm run validate -- <endpoint> <instance.json | ->
//
//   endpoint: grasp-search-request | grasp-search-response |
//             recommendation-request | recommendation-response
//   instance: path to a JSON file, or "-" to read stdin.
//
// Exit 0 = the instance conforms AND its contractVersion (if present) matches
// the canonical contract-version.json. Exit 1 = it would be rejected on the
// wire; the reasons are printed. This is the same judgement the envelope +
// schema make at runtime, so consumers can check payloads before sending them.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const endpoints = [
  "grasp-search-request",
  "grasp-search-response",
  "recommendation-request",
  "recommendation-response",
];

const [endpoint, instancePath] = process.argv.slice(2);

if (!endpoints.includes(endpoint) || !instancePath) {
  console.error(
    [
      "usage: npm run validate -- <endpoint> <instance.json | ->",
      "",
      "endpoints:",
      ...endpoints.map((e) => `  ${e}`),
      "",
      "examples:",
      `  npm run validate -- grasp-search-response examples/grasp-search-response.json`,
      `  cat payload.json | npm run validate -- recommendation-request -`,
    ].join("\n"),
  );
  process.exit(1);
}

const readJson = (path) =>
  JSON.parse(
    path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8"),
  );

const schema = readJson(join(root, "schema", `${endpoint}.schema.json`));
const { contractVersion } = readJson(join(root, "contract-version.json"));
const instance = readJson(instancePath);

const ajv = new Ajv2020({ strict: true, allErrors: true, discriminator: true });
const validate = ajv.compile(schema);

const problems = [];

if (!validate(instance)) {
  for (const err of validate.errors) {
    problems.push(`schema: ${err.instancePath || "/"} ${err.message}`);
  }
}

// Envelope rule (ADR-0004): a mismatched contractVersion is rejected with 400
// before the payload is even read. Surface that here too.
if (
  instance.contractVersion !== undefined &&
  instance.contractVersion !== contractVersion
) {
  problems.push(
    `envelope: contractVersion ${instance.contractVersion} != canonical ${contractVersion} (would be rejected with 400)`,
  );
}
if (instance.contractVersion === undefined) {
  console.warn(
    `note: no contractVersion in the instance; the wire form carries ${contractVersion}`,
  );
}

if (problems.length === 0) {
  console.log(`ok: conforms to ${endpoint} (contractVersion=${contractVersion})`);
  process.exit(0);
}

console.error(`rejected as ${endpoint}:`);
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
