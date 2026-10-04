import type { Change, Descriptor, Placement } from "@/shared/types"

const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** `ul.list`, `li#x`, `div`: short human label for a parent. */
const label = (d: Descriptor) => d.tag + (d.id ? `#${d.id}` : d.classes[0] ? `.${d.classes[0]}` : "")

const where = (p: Placement) => `${label(p.parent)}[${p.index}]`

/** Human readable one-liner for a log entry, shown under its selector in the Changes tab. */
export function summarize(c: Change): string {
  switch (c.kind) {
    case "style":
      return `${c.prop}: ${c.before === null ? "unset" : clip(c.before)} → ${c.after === null ? "removed" : clip(c.after)}`
    case "attr":
      return `${c.name}: ${c.before === null ? "unset" : clip(c.before)} → ${c.after === null ? "removed" : clip(c.after)}`
    case "text":
      return `"${clip(c.before)}" → "${clip(c.after)}"`
    case "class":
      return [...c.added.map((x) => `+${x}`), ...c.removed.map((x) => `-${x}`)].join(" ")
    case "move":
      return c.from.parent.selector === c.to.parent.selector
        ? `index ${c.from.index} → ${c.to.index} in ${label(c.to.parent)}`
        : `${where(c.from)} → ${where(c.to)}`
    case "delete":
      return "Element removed"
    case "insert":
      return `${c.duplicateOf ? "Duplicate" : "Inserted"} at index ${c.placement.index} in ${label(c.placement.parent)}`
  }
}
