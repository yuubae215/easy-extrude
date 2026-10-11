/**
 * DeclarationOwnership — which entity OWNS each declaration, and therefore which
 * panel it lives on (ADR-164 D1).
 *
 * ## Why a table, not a convention
 *
 * Before ADR-164 every grasp declaration sat in one panel opened from the
 * selected ROBOT: a workpiece's mass, the tcp's hand, the camera, the weights.
 * The schema already knew who owned each fact (mass on the Solid, hand on the
 * tcp); only the screen put them under the wrong subject (原則 #33 — the words
 * existed, the line did not). A convention ("put it where it belongs") cannot be
 * asked at the moment someone adds a field; a table can — the census
 * (`src/components/NPanel/DeclarationOwnership.test.js`) reads every
 * `data-declaration="…"` in the components and fails when one sits outside the
 * home this table names, or when a declaration here has no editor at all.
 *
 * ## The six rows are the population
 *
 * A declaration not in this table is not to be built (ADR-164 D1). Adding one is
 * adding a row — a decision about its owner — before adding a field.
 *
 * ## Rows that have not moved yet are DECLARED, not inferred (原則 #31)
 *
 * One domain still lives in the grasp-search panel because its owner does not
 * exist on screen yet: the user's criteria on the floor (ADR-165). The grasp
 * RELATION moved to its own panel in ADR-164 D2, the CAMERA to its own entity
 * and panel in ADR-164 D3. It says which decision moves it (`movesWith`). The census pins the set of such rows, so a new
 * declaration cannot quietly join the "not yet" bucket, and a row that moved
 * must drop its `movesWith` in the same change.
 */

/** The six domains (ADR-164 D1). */
export const DECLARATION_DOMAIN = Object.freeze({
  WORK:   'work',
  HAND:   'hand',
  GRASP:  'grasp',
  VISION: 'vision',
  ARM:    'arm',
  USER:   'user',
})

/**
 * Where a declaration's editor is rendered. One home per row; the census maps each
 * home to the ONE component file allowed to hold that row's editors.
 */
export const DECLARATION_HOME = Object.freeze({
  /** the N panel body for a selected Solid */
  WORK_PANEL:  'work-panel',
  /** the N panel body for a selected robot tcp frame */
  TCP_PANEL:   'tcp-panel',
  /** the N panel body for a selected robot base frame */
  ROBOT_PANEL: 'robot-panel',
  /** the N panel body for a selected grasp relation (ADR-164 D2) */
  RELATION_PANEL: 'relation-panel',
  /** the N panel body for a selected vision camera frame (ADR-164 D3) */
  CAMERA_PANEL: 'camera-panel',
  /** the grasp-search panel — a CHECK beside its subject (ADR-110), and the
   *  interim home of the rows whose owner is not on screen yet */
  GRASP_PANEL: 'grasp-panel',
})

/**
 * @typedef {{
 *   domain: string,
 *   owner: string,
 *   declarations: readonly string[],
 *   home: string,
 *   movesWith: string|null,
 * }} DeclarationOwnerRow
 */

/** @type {readonly DeclarationOwnerRow[]} */
export const DECLARATION_OWNERS = Object.freeze([
  Object.freeze({
    domain: DECLARATION_DOMAIN.WORK,
    owner: 'the object to be grasped (Solid)',
    declarations: Object.freeze(['mass', 'centerOfMass']),
    home: DECLARATION_HOME.WORK_PANEL,
    movesWith: null,
  }),
  Object.freeze({
    domain: DECLARATION_DOMAIN.HAND,
    owner: "the robot's tcp",
    declarations: Object.freeze(['hand', 'hand.hold']),
    home: DECLARATION_HOME.TCP_PANEL,
    movesWith: null,
  }),
  Object.freeze({
    domain: DECLARATION_DOMAIN.GRASP,
    owner: 'the grasp relation (object × hand)',
    // `graspFeature.tcp` is the relation's right-hand side — which hand
    // (ADR-164 D2). Its own key because it is edited on its own (re-pointing a
    // broken relation touches nothing else). `graspFeature.lift` is how it is
    // lifted out — moved off the object onto the relation by ADR-164 D4.
    declarations: Object.freeze(['graspFeature', 'graspFeature.tcp', 'graspFeature.lift']),
    home: DECLARATION_HOME.RELATION_PANEL,
    movesWith: null,
  }),
  Object.freeze({
    domain: DECLARATION_DOMAIN.VISION,
    owner: 'the camera',
    // The field of view — the one fact the camera's pose cannot say (its pose is
    // the frame's own, ADR-164 D3).
    declarations: Object.freeze(['camera']),
    home: DECLARATION_HOME.CAMERA_PANEL,
    movesWith: null,
  }),
  Object.freeze({
    domain: DECLARATION_DOMAIN.ARM,
    owner: 'the robot (its base)',
    declarations: Object.freeze(['reachEnvelope']),
    home: DECLARATION_HOME.ROBOT_PANEL,
    movesWith: null,
  }),
  Object.freeze({
    domain: DECLARATION_DOMAIN.USER,
    owner: 'the person asking for the search',
    declarations: Object.freeze(['objectiveWeights', 'topN']),
    home: DECLARATION_HOME.GRASP_PANEL,
    movesWith: 'ADR-165',
  }),
])

/**
 * Document addresses that are READ but never written — a retired place a
 * declaration used to live, mapped to the declaration it is read as. They have
 * no editor (nothing writes them), so they are not rows; the lookup resolves them
 * to the owner of what they mean. ADR-164 D4: the Solid's `lift` is migrated
 * onto the grasp relation on read (`resolveDeclaredLift`).
 */
export const LEGACY_DECLARATION_ADDRESS = Object.freeze({
  lift: 'graspFeature.lift',
})

/**
 * The row that owns a declaration key. Throws on a key no row declares — an
 * editor for an ownerless declaration is the defect ADR-164 removes, so the
 * lookup must not fall through to a default home (原則 #31).
 * @param {string} key  a declaration key, or a legacy address (`LEGACY_DECLARATION_ADDRESS`)
 * @returns {DeclarationOwnerRow}
 */
export function ownerOfDeclaration(key) {
  const current = Object.hasOwn(LEGACY_DECLARATION_ADDRESS, key) ? LEGACY_DECLARATION_ADDRESS[key] : key
  const row = DECLARATION_OWNERS.find(r => r.declarations.includes(current))
  if (!row) throw new Error(`DeclarationOwnership: "${key}" has no owner row (ADR-164 D1)`)
  return row
}
