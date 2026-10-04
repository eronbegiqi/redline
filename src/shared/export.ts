import type {
  Change,
  Descriptor,
  PageInfo,
  Placement,
  SourceHint,
} from "./types"

// Pure + deterministic (no Date.now, no locale). See docs/SPEC.md "Export format".
export interface ExportMeta {
  page: PageInfo
  /** ISO date string supplied by the caller. */
  capturedAt: string
  /** Free-text instructions the user typed for the AI. May be empty. */
  note?: string
}

const MAX_TEXT = 120
const MAX_HTML = 400
// Not in the spec: a safety valve so one data: URI or giant font stack cannot flood the prompt.
const MAX_VALUE = 200
const MAX_TAG = 400

const UNSET_STYLE = "(unset inline / from stylesheet)"
const UNSET_ATTR = "(not set)"
const REMOVED = "(removed)"

const FRAMEWORKS: Record<SourceHint["framework"], string> = {
  react: "React",
  vue: "Vue",
  svelte: "Svelte",
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim()

/** Cut to `max` UTF-16 units (never inside a surrogate pair) and mark the cut with an ellipsis. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s
  let cut = s.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return `${cut}…`
}

/**
 * Inline code span on one line. Backticks in the value are handled the CommonMark way: a fence one
 * longer than the longest backtick run (backslashes do not escape inside code spans).
 */
function code(s: string, max = MAX_VALUE): string {
  const v = clip(oneLine(s), max)
  if (!v) return "(empty)"
  const longest = Math.max(
    0,
    ...(v.match(/`+/g) ?? []).map((run) => run.length)
  )
  const fence = "`".repeat(longest + 1)
  const pad = v.startsWith("`") || v.endsWith("`") ? " " : ""
  return `${fence}${pad}${v}${pad}${fence}`
}

/** Double-quoted text. JSON escaping keeps newlines/quotes unambiguous and the bullet on one line. */
const quote = (s: string | null | undefined, max = MAX_TEXT) =>
  JSON.stringify(clip(s ?? "", max))

const value = (s: string | null | undefined, ifMissing: string) =>
  s == null ? ifMissing : code(s)

/** `index 3 in `ul.list` (before `li.x`)` */
function where(p: Placement): string {
  const before = p.before ? ` (before ${code(p.before.selector)})` : ""
  return `index ${p.index} in ${code(p.parent.selector)}${before}`
}

function line(c: Change): string {
  switch (c.kind) {
    case "style":
      return `**Style** ${code(c.prop)}: ${value(c.before, UNSET_STYLE)} → ${value(c.after, REMOVED)}`
    case "text": {
      // Several text nodes can live in one element: say which one when it is not the first child.
      const node = c.textNode > 0 ? ` (child node ${c.textNode})` : ""
      return `**Text**${node}: ${quote(c.before)} → ${quote(c.after)}`
    }
    case "attr":
      return `**Attribute** ${code(c.name)}: ${value(c.before, UNSET_ATTR)} → ${value(c.after, REMOVED)}`
    case "class": {
      const parts = [
        c.added.length ? `added ${c.added.map((x) => code(x)).join(" ")}` : "",
        c.removed.length
          ? `removed ${c.removed.map((x) => code(x)).join(" ")}`
          : "",
      ].filter(Boolean)
      return `**Class**: ${parts.join(", ") || "(no net change)"}`
    }
    case "move":
      return `**Move**: from ${where(c.from)} → ${where(c.to)}`
    case "delete":
      return "**Delete**: remove this element"
    case "insert": {
      const copy = c.duplicateOf
        ? ` (copy of ${code(c.duplicateOf.selector)})`
        : ""
      return `**Insert**${copy} at ${where(c.placement)}: ${code(c.html, MAX_HTML)}`
    }
    default:
      return `**Change**: ${code(JSON.stringify(c))}`
  }
}

const bullet = (c: Change) =>
  `- ${line(c)}${c.origin === "devtools" ? " _(DevTools)_" : ""}`

/** `React: Hero › CtaButton · src/Hero.tsx:42` (outermost component first; column is dropped). */
function source(s: SourceHint): string {
  const names = s.chain?.length
    ? [...s.chain].reverse().join(" › ")
    : (s.component ?? "")
  const file = s.file ? (s.line != null ? `${s.file}:${s.line}` : s.file) : ""
  const detail = [names, file].filter(Boolean).join(" · ")
  const label = FRAMEWORKS[s.framework] ?? String(s.framework)
  return detail ? `${label}: ${detail}` : label
}

function heading(n: number, t: Descriptor): string {
  const text = t.text ? ` ${quote(t.text, 80)}` : ""
  const src = t.source ? ` - ${source(t.source)}` : ""
  return `### ${n}. ${code(t.selector)}${text}${src}`
}

/**
 * Not in the spec: the element's opening tag as first seen. Class names and test ids are what an
 * assistant can actually grep for in source, so this is the most useful locator after the hint.
 * Skipped when it would only repeat the selector.
 */
function markup(t: Descriptor): string | null {
  const attrs = Object.entries(t.attrs ?? {})
  if (!t.classes?.length && !attrs.length) return null
  const pairs: [string, string][] = []
  if (t.id) pairs.push(["id", t.id])
  if (t.classes?.length) pairs.push(["class", t.classes.join(" ")])
  pairs.push(...attrs)
  const html = pairs
    .map(([k, v]) => ` ${k}="${oneLine(v).replace(/"/g, "&quot;")}"`)
    .join("")
  return `Element: ${code(`<${t.tag}${html}>`, MAX_TAG)}`
}

const PREAMBLE =
  "Apply the changes below to this page's source code. Find each element using its component/source hint, selector or text. " +
  "Values are computed CSS from the live page: translate them into the project's own styling approach " +
  "(Tailwind classes, CSS modules, styled-components, …) instead of adding inline styles, and keep the result responsive. " +
  "Change only what is listed. Indexes are 0-based among the parent's element children."

/** Markdown prompt for an AI coding assistant. See docs/SPEC.md "Export format". */
export function buildExport(changes: Change[], meta: ExportMeta): string {
  const { page } = meta
  const out = [
    "# Redline: UI changes to apply",
    "",
    `**Page:** ${[oneLine(page.title), page.url].filter(Boolean).join(" - ")}`,
    `**Viewport:** ${page.viewport.width}×${page.viewport.height} · **Captured:** ${meta.capturedAt}`,
    "",
  ]
  const note = meta.note?.trim()
  if (changes.length) out.push(PREAMBLE, "")
  if (note) out.push("## Notes", note, "")
  if (!changes.length) return [...out, "No changes recorded.", ""].join("\n")

  const groups = new Map<string, Change[]>()
  for (const c of changes) {
    const group = groups.get(c.el)
    if (group) group.push(c)
    else groups.set(c.el, [c])
  }

  out.push("## Changes")
  let n = 0
  for (const group of groups.values()) {
    const target = group[0].target
    if (n) out.push("")
    out.push(heading(++n, target))
    const el = markup(target)
    if (el) out.push(el)
    out.push(...group.map(bullet))
  }
  return [...out, ""].join("\n")
}
