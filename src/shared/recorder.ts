import type { Change, NewChange } from "./types"

// Pure TS: no DOM, no chrome.*. See docs/SPEC.md "Recorder rules".

/** A producer's change minus its closure. Distributes over the union so `kind` still narrows. */
type Draft = NewChange extends infer T
  ? T extends unknown
    ? Omit<T, "revert">
    : never
  : never
type Of<K extends Change["kind"]> = Extract<Change, { kind: K }>

interface Revert {
  /** Position in record() order. Reverts always run highest-first, across entries too. */
  seq: number
  fn: () => void
}

interface Entry {
  change: Change
  reverts: Revert[]
  /** seq of the last record() that created or merged into this entry; undo() picks the highest. */
  touched: number
}

/** Two CSS values are the same edit when they differ only in case/outer whitespace. null only equals null. */
const sameCss = (a: string | null, b: string | null) =>
  (a?.trim().toLowerCase() ?? null) === (b?.trim().toLowerCase() ?? null)

/** Merge key per SPEC. null = never merges (delete, insert). */
function keyOf(c: Draft): string | null {
  switch (c.kind) {
    case "style":
      return `style│${c.el}│${c.prop}`
    case "text":
      return `text│${c.el}│${c.textNode}`
    case "attr":
      return `attr│${c.el}│${c.name}`
    case "class":
    case "move":
      return `${c.kind}│${c.el}`
    default:
      return null
  }
}

/** True when the change leaves the page exactly as it was originally. */
function isNoop(c: Draft): boolean {
  switch (c.kind) {
    case "style":
      return sameCss(c.before, c.after)
    // attr values are case-sensitive (href, data-state, ...): only the style row of the spec folds case.
    case "text":
    case "attr":
      return c.before === c.after
    case "class":
      return c.added.length === 0 && c.removed.length === 0
    case "move":
      return (
        c.from.parent.selector === c.to.parent.selector &&
        c.from.index === c.to.index
      )
    default:
      return false
  }
}

/** Fold `next` into `prev` (same merge key, hence same kind). Keeps prev's target/origin/before/from. */
function join(prev: Change, next: Draft): Change {
  switch (next.kind) {
    case "style":
    case "text":
    case "attr":
      return { ...prev, after: next.after } as Change
    case "move":
      return { ...prev, to: next.to } as Change
    case "class": {
      const p = prev as Of<"class">
      const prevAdded = new Set(p.added)
      const prevRemoved = new Set(p.removed)
      const added = new Set(next.added)
      const removed = new Set(next.removed)
      // A class added then removed (or the reverse) nets out; anything else accumulates.
      return {
        ...p,
        added: [
          ...new Set([
            ...p.added.filter((c) => !removed.has(c)),
            ...next.added.filter((c) => !prevRemoved.has(c)),
          ]),
        ],
        removed: [
          ...new Set([
            ...p.removed.filter((c) => !added.has(c)),
            ...next.removed.filter((c) => !prevAdded.has(c)),
          ]),
        ],
      }
    }
    default:
      return prev
  }
}

// Newest first, so each revert sees the DOM the way its change left it. One throwing revert must not strand the rest.
function runReverts(reverts: Revert[]): void {
  for (const { fn } of [...reverts].sort((a, b) => b.seq - a.seq)) {
    try {
      fn()
    } catch {
      // The element may be gone or the page may have moved on; keep reverting the others.
    }
  }
}

export class Recorder {
  private entries: Entry[] = []
  private listeners = new Set<() => void>()
  private nextId = 1
  private tick = 0

  /** Add a change, merging/cancelling per the rules in SPEC. Returns the resulting log entry, or null if it cancelled out / was a no-op. */
  record(nc: NewChange): Change | null {
    const { revert, ...rest } = nc
    const draft = structuredClone(rest) as Draft
    const seq = ++this.tick
    const own: Revert[] = revert ? [{ seq, fn: revert }] : []

    if (draft.kind === "delete") return this.recordDelete(draft, own, seq)

    const key = keyOf(draft)
    const prev =
      key === null
        ? undefined
        : this.entries.find((e) => keyOf(e.change) === key)
    const next = prev ? join(prev.change, draft) : draft
    // Cancelled out: the DOM is already back to the original, so no reverts run.
    if (isNoop(next)) {
      if (!prev) return null
      this.entries = this.entries.filter((e) => e !== prev)
      this.emit()
      return null
    }
    if (!prev) return this.append(draft, own, seq)

    prev.change = { ...next, at: Date.now() } as Change
    prev.reverts.push(...own)
    prev.touched = seq
    this.emit()
    return structuredClone(prev.change)
  }

  /** Wire copy of the log (no closures), oldest first. */
  list(): Change[] {
    return this.entries.map((e) => structuredClone(e.change))
  }

  /** Run the entry's reverts (newest first) then drop it. No-op for unknown ids. */
  revert(id: string): void {
    const entry = this.entries.find((e) => e.change.id === id)
    if (!entry) return
    this.entries = this.entries.filter((e) => e !== entry)
    runReverts(entry.reverts)
    this.emit()
  }

  /** Revert the most recent entry. "Most recent" = last touched, so re-editing an old entry makes it the undo target. */
  undo(): void {
    let last: Entry | undefined
    for (const e of this.entries)
      if (!last || e.touched > last.touched) last = e
    if (last) this.revert(last.change.id)
  }

  /** Revert every entry (newest first) and clear the log. */
  revertAll(): void {
    if (!this.entries.length) return
    const reverts = this.entries.flatMap((e) => e.reverts)
    this.entries = []
    runReverts(reverts)
    this.emit()
  }

  /** Called after every mutation of the log (record/revert/undo/revertAll). Returns unsubscribe. */
  subscribe(fn: () => void): () => void {
    // Wrapped so subscribing the same function twice gives two independent handles.
    const listener = () => fn()
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private recordDelete(
    draft: Draft,
    own: Revert[],
    seq: number
  ): Change | null {
    const mine = this.entries.filter(
      (e) => e.change.el === draft.el && e.change.kind !== "delete"
    )
    this.entries = this.entries.filter((e) => !mine.includes(e))
    // Created this session and now deleted again: nothing to tell the AI.
    if (mine.some((e) => e.change.kind === "insert")) {
      this.emit()
      return null
    }
    // The delete keeps the absorbed reverts. Its own revert has the highest seq, so it runs first (element comes back), then theirs.
    return this.append(draft, [...mine.flatMap((e) => e.reverts), ...own], seq)
  }

  private append(draft: Draft, reverts: Revert[], seq: number): Change {
    const change = {
      ...draft,
      id: `c${this.nextId++}`,
      at: Date.now(),
    } as Change
    this.entries.push({ change, reverts, touched: seq })
    this.emit()
    return structuredClone(change)
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // A faulty subscriber must not break record() or starve the others.
      }
    }
  }
}
