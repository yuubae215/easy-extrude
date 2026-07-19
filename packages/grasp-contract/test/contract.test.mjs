// Conformance tests for the easy-extrude wire contracts.
//
// The schema is the single source of truth; examples/ are the canonical wire
// instances consumers copy from. Drift is detected at both ends:
//   1. every example in examples/ validates against its schema,
//   2. every example's envelope pins the canonical contractVersion
//      (contract-version.json stays the only version authority; the copies in
//      examples/ are derived and this check keeps them from drifting),
//   3. the grasp-search `pose` stays a *closed* kind-discriminated union --
//      switching on `kind` narrows to exactly one closed branch, so a consumer
//      reads typed fields without guessing (Rigor on the Wire, ADR-0005),
//   4. the decision layers stay closed: the score breakdown rejects unknown
//      fields and the recommendation proposal rejects smuggled verdicts.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const readJson = (...parts) =>
  JSON.parse(readFileSync(join(root, ...parts), "utf8"));

const { contractVersion } = readJson("contract-version.json");

const endpoints = [
  "grasp-search-request",
  "grasp-search-response",
  "recommendation-request",
  "recommendation-response",
];

const ajv = new Ajv2020({ strict: true, allErrors: true, discriminator: true });
const validators = {};
const examples = {};
for (const name of endpoints) {
  validators[name] = ajv.compile(readJson("schema", `${name}.schema.json`));
  examples[name] = readJson("examples", `${name}.json`);
}

// --- tiny runner (no test framework dependency) ----------------------------
let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}

const accepts = (endpoint, instance) => {
  const validate = validators[endpoint];
  if (!validate(instance)) {
    throw new Error("expected valid, got: " + ajv.errorsText(validate.errors));
  }
};
const rejects = (endpoint, instance) => {
  if (validators[endpoint](instance)) {
    throw new Error("expected invalid, but it validated");
  }
};

// --- examples/: canonical instances conform and pin the shared version ------
for (const name of endpoints) {
  test(`examples/${name}.json conforms to its schema`, () =>
    accepts(name, examples[name]));
  test(`examples/${name}.json carries the canonical contractVersion`, () =>
    assert.equal(examples[name].contractVersion, contractVersion));
}

// --- grasp-search pose union (ADR-0005) --------------------------------------
// The per-kind instances are read from the canonical example, not redefined.
const response = examples["grasp-search-response"];
const endEffectorPose = response.candidates.find(
  (c) => c.pose.kind === "endEffector",
).pose;
const jointSpacePose = response.candidates.find(
  (c) => c.pose.kind === "jointSpace",
).pose;
const score = response.candidates[0].score;

// diagnostics is required on the response envelope (contractVersion 3), so the
// pose-union cases below carry a valid funnel and every rejection isolates the
// pose/score violation under test -- not a missing diagnostics block.
const diagnostics = response.diagnostics;
const withDiag = (candidates) => ({ candidates, diagnostics });

test("endEffector pose conforms on its own", () =>
  accepts("grasp-search-response", withDiag([{ rank: 1, pose: endEffectorPose, score }])));

test("jointSpace pose conforms on its own", () =>
  accepts("grasp-search-response", withDiag([{ rank: 1, pose: jointSpacePose, score }])));

// --- discriminated union: kind narrows to exactly one closed branch ---------
// This is the consumer's read path: type-safe by switching on `kind`.
function readPose(pose) {
  switch (pose.kind) {
    case "endEffector":
      return { frame: pose.frame };
    case "jointSpace":
      return { chainRef: pose.chainRef, joints: pose.joints };
    default:
      throw new Error(`unknown pose kind: ${pose.kind}`);
  }
}

test("endEffector narrows to a readable frame", () => {
  const read = readPose(endEffectorPose);
  assert.deepEqual(read.frame.position, [0.42, -0.13, 0.3]);
  assert.equal(read.frame.orientation.length, 4);
});

test("jointSpace narrows to chainRef + joints", () => {
  const read = readPose(jointSpacePose);
  assert.equal(read.chainRef, "ur5e/arm");
  assert.equal(read.joints.length, 6);
});

// --- pose layer is a *closed* union, not opaque / mixed / open --------------
test("unknown kind is rejected (closed set)", () =>
  rejects("grasp-search-response", withDiag([{ rank: 1, pose: { kind: "cabinet" }, score }])));

test("kind-less opaque pose is rejected (no longer additionalProperties:true)", () =>
  rejects("grasp-search-response", withDiag([{ rank: 1, pose: { whatever: 123 }, score }])));

test("mixed-branch pose is rejected (each branch is additionalProperties:false)", () =>
  rejects("grasp-search-response", withDiag([
    {
      rank: 1,
      pose: { kind: "endEffector", frame: endEffectorPose.frame, joints: [0] },
      score,
    },
  ])));

test("endEffector missing frame is rejected", () =>
  rejects("grasp-search-response", withDiag([{ rank: 1, pose: { kind: "endEffector" }, score }])));

test("jointSpace missing chainRef is rejected", () =>
  rejects("grasp-search-response", withDiag([{ rank: 1, pose: { kind: "jointSpace", joints: [0] }, score }])));

test("wrong-length quaternion is rejected", () =>
  rejects("grasp-search-response", withDiag([
    {
      rank: 1,
      pose: {
        kind: "endEffector",
        frame: { position: [0, 0, 0], orientation: [0, 0, 1] },
      },
      score,
    },
  ])));

// --- inverse rule: the decision layers stay closed --------------------------
test("score layer rejects unknown fields (additionalProperties:false held)", () =>
  rejects("grasp-search-response", withDiag([
    { rank: 1, pose: endEffectorPose, score: { ...score, sneakyVerdict: true } },
  ])));

test("recommendation proposal rejects a smuggled equivalence verdict", () => {
  const [proposal] = examples["recommendation-response"].proposals;
  rejects("recommendation-response", {
    proposals: [{ ...proposal, equivalent: true }],
  });
});

test("recommendation evidence rejects unknown fields", () => {
  const [proposal] = examples["recommendation-response"].proposals;
  rejects("recommendation-response", {
    proposals: [
      { ...proposal, evidence: { ...proposal.evidence, ghostColor: "#ff00ff" } },
    ],
  });
});

// --- diagnostics: the rejection funnel (contractVersion 3) -------------------
// The funnel is solver-decided aggregate facts about the whole search, so a
// client can explain an empty or thin result. Presentation stays client-side.

// candidates present + a numeric near-miss (the canonical example).
test("response with a full funnel and numeric reachNearestMiss conforms", () =>
  accepts("grasp-search-response", response));

// empty result, rejected by reach -> reachNearestMiss is the smallest miss.
const emptyByReach = {
  candidates: [],
  diagnostics: {
    candidatesGenerated: 4,
    rejectedByReach: 4,
    rejectedByIk: 0,
    rejectedByInterference: 0,
    feasible: 0,
    returned: 0,
    reachNearestMiss: 0.12,
  },
};
test("empty result rejected by reach (numeric reachNearestMiss) conforms", () =>
  accepts("grasp-search-response", emptyByReach));

// empty result, nothing rejected by reach -> reachNearestMiss is null.
const emptyByIk = {
  candidates: [],
  diagnostics: {
    candidatesGenerated: 3,
    rejectedByReach: 0,
    rejectedByIk: 3,
    rejectedByInterference: 0,
    feasible: 0,
    returned: 0,
    reachNearestMiss: null,
  },
};
test("empty result with no reach rejections (null reachNearestMiss) conforms", () =>
  accepts("grasp-search-response", emptyByIk));

// The funnel is a closed object: no presentation ("Close!" copy, colors,
// meters, suggestion text) may ride the wire.
test("diagnostics rejects unknown fields (additionalProperties:false held)", () =>
  rejects("grasp-search-response", {
    candidates: [],
    diagnostics: { ...emptyByIk.diagnostics, closenessHint: "so close!" },
  }));

// diagnostics is required: the producer always emits it, so consumers never
// branch on presence/absence.
test("response without diagnostics is rejected (required on the envelope)", () =>
  rejects("grasp-search-response", { candidates: response.candidates }));

// A missing required funnel field is rejected (the funnel is closed + complete).
test("diagnostics missing reachNearestMiss is rejected", () => {
  const { reachNearestMiss, ...rest } = emptyByIk.diagnostics;
  rejects("grasp-search-response", { candidates: [], diagnostics: rest });
});

// Funnel invariant on the test data: generated = sum of exclusive rejection
// stages + feasible, and returned = min(feasible, topN) <= feasible. The schema
// can't express this arithmetic; the conformance data must satisfy it so the
// canonical instances stay a faithful source of truth.
for (const [label, d] of [
  ["canonical example", response.diagnostics],
  ["emptyByReach", emptyByReach.diagnostics],
  ["emptyByIk", emptyByIk.diagnostics],
]) {
  test(`funnel invariant holds for ${label}`, () => {
    assert.equal(
      d.candidatesGenerated,
      d.rejectedByReach + d.rejectedByIk + d.rejectedByInterference + d.feasible,
    );
    assert.ok(d.returned <= d.feasible, "returned must not exceed feasible");
    // reachNearestMiss is null exactly when nothing was rejected by reach.
    assert.equal(d.reachNearestMiss === null, d.rejectedByReach === 0);
  });
}

// The canonical example's returned count matches the wire candidates[] length.
test("diagnostics.returned matches candidates[] length in the example", () =>
  assert.equal(response.diagnostics.returned, response.candidates.length));

// --- request envelopes: required fields hold ---------------------------------
test("grasp-search request without layoutVersion is rejected", () => {
  const { layoutVersion, ...rest } = examples["grasp-search-request"];
  rejects("grasp-search-request", rest);
});

test("recommendation request without requirement.text is rejected", () => {
  const example = examples["recommendation-request"];
  rejects("recommendation-request", {
    ...example,
    requirement: { signature: example.requirement.signature },
  });
});

console.log(
  `\ncontract conformance: ${failures === 0 ? "all green" : failures + " failing"} (contractVersion=${contractVersion})`,
);
process.exit(failures === 0 ? 0 : 1);
