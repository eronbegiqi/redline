import type { Snapshot, Store } from "@/panel/bridge"
import type { ToContent } from "@/shared/protocol"
import type {
  Change,
  Descriptor,
  ElementInfo,
  NewChange,
  PanelState,
  StyleProp,
} from "@/shared/types"

// Fake page state for `npm run dev` at /panel.html (not embedded). `send` applies a rough version of what the
// content script would do. Variants: ?mock=empty (nothing selected, no changes), ?mock=many (40 changes).

const d = (
  selector: string,
  tag: string,
  extra: Partial<Descriptor> = {}
): Descriptor => ({
  selector,
  tag,
  classes: [],
  ...extra,
})

const LONG_SELECTOR =
  "main#app > section.hero:nth-of-type(2) > div:nth-of-type(1) > div:nth-of-type(3) > ul:nth-of-type(1) > li:nth-of-type(4) > a:nth-of-type(1)"

const cta = d(LONG_SELECTOR, "a", {
  classes: ["btn", "btn-primary", "hero__cta", "is-active"],
  text: "Get started",
  attrs: { href: "/signup", "data-testid": "hero-cta" },
  source: {
    framework: "react",
    component: "HeroCta",
    chain: ["HeroCta", "Hero", "App"],
    file: "src/components/Hero.tsx",
    line: 42,
  },
})

const styles: Record<StyleProp, string> = {
  color: "rgb(255, 255, 255)",
  "background-color": "rgb(59, 130, 246)",
  "font-size": "16px",
  "font-weight": "600",
  "line-height": "24px",
  "letter-spacing": "normal",
  "text-align": "center",
  display: "inline-flex",
  width: "148px",
  height: "44px",
  "padding-top": "10px",
  "padding-right": "20px",
  "padding-bottom": "10px",
  "padding-left": "20px",
  "margin-top": "0px",
  "margin-right": "0px",
  "margin-bottom": "0px",
  "margin-left": "0px",
  gap: "8px",
  "border-radius": "8px",
  "border-width": "0px",
  "border-style": "none",
  "border-color": "rgb(255, 255, 255)",
  opacity: "1",
}

const selection: ElementInfo = {
  el: "e1",
  descriptor: cta,
  rect: { x: 412, y: 318, width: 148, height: 44 },
  isTextLeaf: true,
  text: "Get started",
  styles,
  hasParent: true,
  hasChild: false,
  canDelete: true,
}

const list = d("main > ul.plans", "ul", { classes: ["plans"] })
const at = 1_700_000_000_000
const sample: Change[] = [
  {
    id: "c1",
    el: "e1",
    target: cta,
    origin: "panel",
    at,
    kind: "style",
    prop: "background-color",
    before: "rgb(0, 0, 0)",
    after: "rgb(59, 130, 246)",
  },
  {
    id: "c2",
    el: "e1",
    target: cta,
    origin: "panel",
    at,
    kind: "style",
    prop: "border-radius",
    before: null,
    after: "8px",
  },
  {
    id: "c3",
    el: "e2",
    target: d("main#app > h1", "h1", { text: "Simple pricing" }),
    origin: "panel",
    at,
    kind: "text",
    textNode: 0,
    before: "Simple pricing",
    after: "Pricing that scales with your team, not against it",
  },
  {
    id: "c4",
    el: "e1",
    target: cta,
    origin: "devtools",
    at,
    kind: "attr",
    name: "href",
    before: "/signup",
    after: "/signup?plan=pro",
  },
  {
    id: "c5",
    el: "e3",
    target: d("button.cta", "button", { classes: ["cta", "muted"] }),
    origin: "devtools",
    at,
    kind: "class",
    added: ["is-active", "shadow-lg"],
    removed: ["muted"],
  },
  {
    id: "c6",
    el: "e4",
    target: d("main > ul.plans > li:nth-of-type(3)", "li", {
      classes: ["plan"],
    }),
    origin: "panel",
    at,
    kind: "move",
    from: { parent: list, index: 3 },
    to: { parent: list, index: 1 },
  },
  {
    id: "c7",
    el: "e5",
    target: d("div.cookie-banner", "div", { classes: ["cookie-banner"] }),
    origin: "panel",
    at,
    kind: "delete",
  },
  {
    id: "c8",
    el: "e6",
    target: d("main > ul.plans > li:nth-of-type(5)", "li", {
      classes: ["plan"],
    }),
    origin: "panel",
    at,
    kind: "insert",
    placement: { parent: list, index: 4 },
    html: '<li class="plan">…</li>',
    duplicateOf: d("main > ul.plans > li:nth-of-type(4)", "li"),
  },
]

const many = (): Change[] =>
  Array.from(
    { length: 40 },
    (_, i) =>
      ({
        ...sample[i % sample.length],
        id: `c${i + 1}`,
        el: `e${i + 1}`,
      }) as Change
  )

function initial(variant: string | null): PanelState {
  const empty = variant === "empty"
  return {
    mode: "select",
    recording: false,
    selection: empty ? null : selection,
    changes: empty ? [] : variant === "many" ? many() : sample,
    page: {
      url: "http://localhost:5173/pricing",
      title: "Pricing - Acme",
      viewport: { width: 1440, height: 900 },
    },
  }
}

export function createMockStore(
  variant = new URLSearchParams(location.search).get("mock")
): Store {
  let state = initial(variant)
  let snap: Snapshot = { state, connected: true }
  let nextId = state.changes.length + 1
  const subs = new Set<() => void>()
  const set = (patch: Partial<PanelState>) => {
    state = { ...state, ...patch }
    snap = { state, connected: true }
    subs.forEach((f) => f())
  }
  // Merge by (el, kind, key) like the real recorder does.
  const upsert = (c: NewChange, same: (o: Change) => boolean) => {
    const old = state.changes.find(same)
    if (!old)
      return [
        ...state.changes,
        { ...c, id: `c${nextId++}`, at: Date.now() } as Change,
      ]
    return state.changes.map((o) =>
      o === old ? ({ ...o, ...c, id: o.id, at: Date.now() } as Change) : o
    )
  }

  const send = (m: ToContent): void => {
    const sel = state.selection
    switch (m.type) {
      case "setMode":
        return set({ mode: m.mode })
      case "setRecording":
        return set({ recording: m.on })
      case "setStyle": {
        if (!sel || sel.el !== m.el) return // the mock only knows the one element
        const before = state.changes.find(
          (c) => c.kind === "style" && c.el === sel.el && c.prop === m.prop
        )
        const base = {
          el: sel.el,
          target: sel.descriptor,
          origin: "panel",
        } as const
        const changes = upsert(
          {
            ...base,
            kind: "style",
            prop: m.prop,
            before:
              before?.kind === "style"
                ? before.before
                : (sel.styles[m.prop as StyleProp] ?? null),
            after: m.value || null,
          },
          (c) => c.kind === "style" && c.el === sel.el && c.prop === m.prop
        )
        return set({
          changes,
          selection: { ...sel, styles: { ...sel.styles, [m.prop]: m.value } },
        })
      }
      case "setText": {
        if (!sel || sel.el !== m.el) return
        const prev = state.changes.find(
          (c) => c.kind === "text" && c.el === sel.el
        )
        const before = prev?.kind === "text" ? prev.before : sel.text
        const changes = upsert(
          {
            el: sel.el,
            target: sel.descriptor,
            origin: "panel",
            kind: "text",
            textNode: 0,
            before,
            after: m.text,
          },
          (c) => c.kind === "text" && c.el === sel.el
        )
        return set({ changes, selection: { ...sel, text: m.text } })
      }
      case "action": {
        if (!sel || sel.el !== m.el) return
        if (m.action === "hide")
          return send({
            type: "setStyle",
            el: m.el,
            prop: "display",
            value: "none",
          })
        if (m.action === "deselect") return set({ selection: null })
        const base = {
          el: sel.el,
          target: sel.descriptor,
          origin: "panel",
        } as const
        if (m.action === "delete")
          return set({
            changes: upsert({ ...base, kind: "delete" }, () => false),
            selection: null,
          })
        if (m.action === "duplicate")
          return set({
            changes: upsert(
              {
                ...base,
                kind: "insert",
                placement: { parent: list, index: 4 },
                html: "<a>…</a>",
                duplicateOf: sel.descriptor,
              },
              () => false
            ),
          })
        return // parent/child: selection traversal is not mocked
      }
      case "undo":
        return set({ changes: state.changes.slice(0, -1) })
      case "revert":
        return set({ changes: state.changes.filter((c) => c.id !== m.id) })
      case "revertAll":
        return set({ changes: [] })
      default:
        return // ready / moveFrame / close: nothing to mock
    }
  }

  return {
    subscribe: (fn) => {
      subs.add(fn)
      return () => void subs.delete(fn)
    },
    get: () => snap,
    send,
  }
}
