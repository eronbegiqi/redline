// Shared data model. Used by the content script (page side) and the React panel.
// Keep this file free of DOM / chrome.* / React imports so it stays unit-testable in plain node.
// NOTE: tsconfig has `erasableSyntaxOnly` -> no enums, namespaces or parameter properties.

export type Mode = "select" | "move" | "browse"

/** Best-effort pointer to the source code behind an element (dev builds only). */
export interface SourceHint {
  framework: "react" | "vue" | "svelte"
  /** Nearest component name, e.g. "HeroCta". */
  component?: string
  /** Component ancestry, nearest first, max 4, e.g. ["HeroCta", "Hero", "App"]. */
  chain?: string[]
  /** Source file path as reported by the framework (may be a bundler path). */
  file?: string
  line?: number
  column?: number
}

/** Human + AI readable description of an element, captured the first time we touch it. */
export interface Descriptor {
  /** Document-unique CSS selector at capture time, e.g. `main > ul.list > li:nth-of-type(3)`. */
  selector: string
  /** Lowercase tag name. */
  tag: string
  id?: string
  /** Class list at capture time (max 8). */
  classes: string[]
  /** The element's own direct text, trimmed, max 80 chars. */
  text?: string
  /** Whitelisted attributes (data-testid, aria-label, role, name, type, href, src, alt, placeholder, title), values max 120 chars. */
  attrs?: Record<string, string>
  source?: SourceHint
}

/** Where an element sits among its parent's *element* children. */
export interface Placement {
  parent: Descriptor
  /** 0-based index among parent's element children. */
  index: number
  /** Descriptor of the element that follows, if any (helps humans/AI orient). */
  before?: Descriptor
}

interface ChangeBase {
  /** Unique id of this log entry ("c1", "c2", ...). */
  id: string
  /** Session-stable element id ("e1", ...) from describe.elementId(). Used for merging. */
  el: string
  /** Description of the element at first touch (original position/classes). */
  target: Descriptor
  /** Who produced it: our own panel/in-page editor, or passively observed from DevTools. */
  origin: "panel" | "devtools"
  /** Epoch ms of the latest update to this entry. */
  at: number
}

export type ChangeBody =
  /** Inline/computed style property. `before: null` = unknown / not set inline (value came from a stylesheet). `after: null` = removed. */
  | { kind: "style"; prop: string; before: string | null; after: string | null }
  /** Text node content. `textNode` = index among target.childNodes (so one element can have several). */
  | { kind: "text"; textNode: number; before: string; after: string }
  /** Any attribute except `style` and `class` (those have their own kinds). */
  | { kind: "attr"; name: string; before: string | null; after: string | null }
  | { kind: "class"; added: string[]; removed: string[] }
  | { kind: "move"; from: Placement; to: Placement }
  /** Element removed from the DOM. */
  | { kind: "delete" }
  /** Element added (duplicate via our UI, or "Edit as HTML"/paste in DevTools). `target` describes the NEW element. */
  | { kind: "insert"; placement: Placement; html: string; duplicateOf?: Descriptor }

export type Change = ChangeBase & ChangeBody

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

/** What producers hand to Recorder.record(). `revert` undoes the DOM effect of this one change. */
export type NewChange = DistributiveOmit<Change, "id" | "at"> & { revert?: () => void }

/** Computed style props the panel can edit. Content reads these via edit.readStyles(). Kebab-case CSS names. */
export const STYLE_PROPS = [
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "display",
  "width",
  "height",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "border-radius",
  "border-width",
  "border-style",
  "border-color",
  "opacity",
] as const
export type StyleProp = (typeof STYLE_PROPS)[number]

export interface ElementInfo {
  /** describe.elementId() */
  el: string
  descriptor: Descriptor
  /** Viewport-relative box, for display only. */
  rect: { x: number; y: number; width: number; height: number }
  /** True when the element has no element children (only text) -> panel shows a text field. */
  isTextLeaf: boolean
  /** Current textContent when isTextLeaf (max 2000 chars). */
  text: string
  /** Computed values for every STYLE_PROPS entry. */
  styles: Record<StyleProp, string>
  hasParent: boolean
  hasChild: boolean
  /** False for <html>/<body>. */
  canDelete: boolean
}

export interface PageInfo {
  url: string
  title: string
  viewport: { width: number; height: number }
}

/** Everything the panel renders from. Pushed by the content script after every change. */
export interface PanelState {
  mode: Mode
  /** Whether the MutationObserver is capturing DevTools edits. */
  recording: boolean
  selection: ElementInfo | null
  /** Wire form of the Recorder log (no closures), oldest first. */
  changes: Change[]
  page: PageInfo
}
