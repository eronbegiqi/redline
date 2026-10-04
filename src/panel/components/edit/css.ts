// Pure CSS-value helpers for the style editor. No DOM, no React: unit-tested in plain node.

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0..1 */
  a: number
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))
const hex2 = (n: number) =>
  clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FN_RE = /^rgba?\(\s*([^)]+?)\s*\)$/i
const CHANNEL_RE = /^[+-]?(\d+\.?\d*|\.\d+)%?$/

/** Channel token -> number. `max` is what 100% means (255 for r/g/b, 1 for alpha). */
const channel = (tok: string, max: number) => {
  if (!CHANNEL_RE.test(tok)) return NaN
  const n = parseFloat(tok)
  return tok.endsWith("%") ? (n / 100) * max : n
}

/**
 * Parses what getComputedStyle gives us ("rgb(r, g, b)", "rgba(r, g, b, a)") plus what a person
 * might type: #rgb[a] / #rrggbb[aa], space-separated rgb() with "/ alpha", and `transparent`.
 * Returns null for anything else (named colours, hsl(), oklch(), var(), multi-value shorthands):
 * callers pass those through untouched.
 */
export function parseColor(input: string): Rgba | null {
  const s = input.trim()
  if (s.toLowerCase() === "transparent") return { r: 0, g: 0, b: 0, a: 0 }

  const hex = HEX_RE.exec(s)?.[1]
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 }
  }

  const fn = FN_RE.exec(s)?.[1]
  if (fn) {
    const t = fn.split(/[\s,/]+/).filter(Boolean)
    if (t.length !== 3 && t.length !== 4) return null
    const [r, g, b] = t.slice(0, 3).map((x) => channel(x, 255))
    const a = t[3] === undefined ? 1 : channel(t[3], 1)
    if ([r, g, b, a].some(Number.isNaN)) return null
    return {
      r: clamp(r, 0, 255),
      g: clamp(g, 0, 255),
      b: clamp(b, 0, 255),
      a: clamp(a, 0, 1),
    }
  }
  return null
}

/** `#rrggbb`, or `#rrggbbaa` when not fully opaque. */
export function toHex({ r, g, b, a }: Rgba): string {
  const alpha = Math.round(clamp(a, 0, 1) * 255)
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${alpha >= 255 ? "" : hex2(alpha)}`
}

/** What we send to the page: hex when parseable, else the trimmed input as typed (names, hsl(), var(--X) keep their case). */
export function emitColor(value: string): string {
  const c = parseColor(value)
  return c ? toHex(c) : value.trim()
}

/** Comparison form: equal spellings of the same colour collapse to one string. */
export const canonColor = (value: string) => emitColor(value).toLowerCase()

/** What the text field shows: hex, `transparent` for the default rgba(0,0,0,0), unparseable values verbatim. */
export function formatColor(value: string): string {
  const c = parseColor(value)
  if (!c) return value.trim()
  const hex = toHex(c)
  return hex === "#00000000" ? "transparent" : hex
}

/** Input for react-colorful. Unparseable values start the picker at black. */
export function pickerHex(value: string): string {
  return toHex(parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 })
}

export const sameValue = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() ===
  b.trim().replace(/\s+/g, " ").toLowerCase()

const BARE_NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/

/** A bare number is not a valid CSS length (except 0): treat it as px unless the property is unitless (line-height). */
export function normalizeLength(raw: string, unitless = false): string {
  const t = raw.trim()
  return !unitless && BARE_NUMBER_RE.test(t) ? `${t}px` : t
}

const NUMBER_UNIT_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i

export interface StepOptions {
  /** Step size; defaults to 1 (0.1 for em/rem/unitless). */
  step?: number
  /** Shift = x10, Alt = x0.1. */
  shift?: boolean
  alt?: boolean
  /** Treat the keyword `normal` as 0px (letter-spacing, gap). */
  zero?: boolean
}

/** ArrowUp/Down on a single `<number><unit>` value. Returns null for anything else ("auto", "10px 20px", calc()). */
export function stepValue(
  value: string,
  dir: 1 | -1,
  o: StepOptions = {}
): string | null {
  const t = value.trim()
  const m =
    NUMBER_UNIT_RE.exec(t) ??
    (o.zero && t.toLowerCase() === "normal" ? ["", "0", "px"] : null)
  if (!m) return null
  const unit = m[2]
  const base = o.step ?? (unit === "" || /^r?em$/i.test(unit) ? 0.1 : 1)
  const amount = base * (o.shift ? 10 : o.alt ? 0.1 : 1)
  // Round away float noise (0.1 + 0.2) without inventing precision.
  const next = Math.round((parseFloat(m[1]) + dir * amount) * 1000) / 1000
  return `${next}${unit}`
}

/** "0.5" for 0.5, "1" for 1: two decimals max, no trailing zeros. */
export const formatNumber = (n: number) => String(Math.round(n * 100) / 100)
