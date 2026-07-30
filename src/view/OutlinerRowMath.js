/**
 * OutlinerRowMath — pure presentation derivation for ONE Outliner row's
 * visibility affordance (eye glyph + grey-out).
 *
 * WHY this is its own module rather than inline JSX ternaries: the eye is now a
 * *status* glyph, not just a hover-only button, and getting that wrong is a
 * silent failure (#11). Before this, a hidden entity looked exactly like a
 * visible one — the eye was `opacity: 0` unless the row was hovered, and its
 * glyph was the OPEN eye in both states. The robot skeleton ships hidden on the
 * default scene (ADR-089 follow-up) with its visibility owned by the
 * `robot_base` row's eye (ADR-087), so the very first thing a user meets is a
 * hidden entity that claims to be visible.
 *
 * DISCIPLINE:
 *   - Pure and THREE-free / DOM-free (`node --test` lane, PHILOSOPHY #3).
 *     Inputs are row state, outputs are plain style fragments; the component
 *     spreads them and owns nothing about the decision.
 *   - This module owns COLOUR/OPACITY state (the static cue), which is exactly
 *     what `ChromeMath` refuses to own — that module is Tier A *motion* only.
 *     The two compose: motion may be dropped under `prefers-reduced-motion`,
 *     the cue here never is (#11 — information preserved, movement dropped).
 *   - Sole derivation point for "is this row shown as hidden?" (#4 — one owner
 *     per visual flag).
 */
import { COLOR } from '../theme/tokens.js'

/**
 * Row-name colour when the row is the active/selected one.
 *
 * One of the six selection painters ADR-100 collapsed onto `accent`. This one
 * was already orange (`#ff8c69`) while the token vocabulary declared selection
 * to be blue-violet — the stakeholder's "make the accent orange" was really a
 * request to make the declaration agree with what the Outliner already did.
 */
const NAME_ACTIVE = COLOR.accent
/** Row-name colour, normal (visible) row. */
const NAME_NORMAL = COLOR.textPrimary
/** Row-name colour, hidden row — legible but clearly demoted. */
const NAME_HIDDEN = '#6f6f6f'

/** Eye tint, visible row (a quiet hover-revealed control). */
const EYE_VISIBLE = '#aaaaaa'
/** Eye tint, hidden row (a persistent status glyph — must read without hover). */
const EYE_HIDDEN = '#8c8c8c'

/** Opacity applied to a hidden row's icon and badges (the "grey out"). */
const CONTENT_HIDDEN_OPACITY = 0.4

/**
 * Derives the visibility-affordance fragment for a row.
 *
 * The load-bearing rule is `eyeOpacity`: on a VISIBLE row the eye stays a
 * hover-revealed control (chrome quiet at rest), but on a HIDDEN row it is
 * pinned on regardless of hover, because it is the only thing on screen saying
 * "this entity exists but is not drawn". A hidden row that looks identical to a
 * visible one until you hover it is the silent no-op #11 forbids.
 *
 * @param {{visible?: boolean, hovered?: boolean, active?: boolean}} state
 * @returns {{
 *   hidden: boolean,
 *   eyeOpen: boolean,
 *   eyeOpacity: number,
 *   eyeColor: string,
 *   eyeTitle: string,
 *   contentOpacity: number,
 *   nameColor: string,
 *   nameStyle: 'normal'|'italic',
 * }}
 */
export function visibilityAffordance({ visible = true, hovered = false, active = false } = {}) {
  const hidden = !visible
  return {
    hidden,
    // The glyph IS the state — an open eye on a hidden row is a lie (#4).
    eyeOpen:        !hidden,
    eyeOpacity:     (hovered || hidden) ? 1 : 0,
    eyeColor:       hidden ? EYE_HIDDEN : EYE_VISIBLE,
    eyeTitle:       hidden ? 'Show' : 'Hide',
    contentOpacity: hidden ? CONTENT_HIDDEN_OPACITY : 1,
    // Active wins over hidden: the selection highlight must stay findable even
    // while the entity is not drawn (you hide something to then go move it).
    nameColor:      active ? NAME_ACTIVE : hidden ? NAME_HIDDEN : NAME_NORMAL,
    // A second, colour-independent channel so the state survives low contrast
    // and colour-vision differences (the glyph is the third).
    nameStyle:      hidden ? 'italic' : 'normal',
  }
}
