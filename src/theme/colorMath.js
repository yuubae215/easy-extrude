/**
 * colorMath.js — pure predicates over colour values (ADR-100).
 *
 * WHY THIS MODULE EXISTS: ADR-100 turns three prose claims about the palette
 * into machine questions — "the entity default is neutral", "two meanings never
 * share a hue", "the accent stays legible on the chrome". Each claim is a
 * NUMBER over the token values, so the token module cannot answer it and the
 * test must not re-implement it (that would make the threshold a second source,
 * §1.1). The functions live here, the thresholds live in `tokens.js` next to the
 * values they judge, and `tokens.test.js` only asks the questions.
 *
 * Pure and dependency-free (原則 #3): plain string/number in, number out. No
 * THREE, no DOM — runs in the bare `node --test` lane.
 */

/**
 * `#rrggbb` → `{r, g, b}` in 0..255.
 * @param {string} hex
 * @returns {{r: number, g: number, b: number}}
 */
export function rgbOf(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) throw new TypeError(`colorMath: expected #rrggbb, got ${JSON.stringify(hex)}`)
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

/**
 * `#rrggbb` → HSL. Hue in `[0, 360)` degrees, saturation/lightness in `[0, 1]`.
 *
 * Hue of a fully neutral colour is undefined, not 0 — a grey has no hue to
 * separate from anything. `hue` is reported as `null` in that case so callers
 * cannot silently treat "grey" as "red" (the same reason ADR-096's default
 * table throws on an undeclared kind: an absent decision must not read as a
 * declared one).
 *
 * @param {string} hex
 * @returns {{hue: number|null, saturation: number, lightness: number}}
 */
export function hslOf(hex) {
  const { r, g, b } = rgbOf(hex)
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const lightness = (max + min) / 2

  if (delta === 0) return { hue: null, saturation: 0, lightness }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1))

  let hue
  if (max === rn)      hue = 60 * (((gn - bn) / delta) % 6)
  else if (max === gn) hue = 60 * ((bn - rn) / delta + 2)
  else                 hue = 60 * ((rn - gn) / delta + 4)
  if (hue < 0) hue += 360

  return { hue, saturation, lightness }
}

/**
 * Shortest angular distance between two hues, in degrees (`0..180`).
 *
 * Circular, so `350°` and `10°` are 20° apart, not 340° — the wheel wraps and
 * a check that forgets that would wave through a red/orange collision.
 *
 * @param {number} a  degrees
 * @param {number} b  degrees
 * @returns {number}
 */
export function hueDistance(a, b) {
  const d = Math.abs(((a % 360) + 360) % 360 - ((b % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

/**
 * WCAG 2.x relative luminance of `#rrggbb` (`0` = black, `1` = white).
 * @param {string} hex
 * @returns {number}
 */
export function relativeLuminance(hex) {
  const { r, g, b } = rgbOf(hex)
  const lin = c => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * WCAG contrast ratio between two colours (`1`..`21`, order-independent).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Is this colour neutral — i.e. does it carry no meaning in its hue?
 *
 * ADR-100 G1 spends saturation on STATE and withholds it from DEFAULTS, so
 * "neutral" has to be a number rather than a matter of taste. A colour counts
 * as neutral when its HSL saturation is at or below `maxSaturation`.
 *
 * @param {string} hex
 * @param {number} maxSaturation  0..1
 * @returns {boolean}
 */
export function isNeutral(hex, maxSaturation) {
  return hslOf(hex).saturation <= maxSaturation
}
