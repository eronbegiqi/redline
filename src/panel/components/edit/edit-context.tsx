import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

import type { ToContent } from "@/shared/protocol"
import type { ElementInfo, StyleProp } from "@/shared/types"

type Action = Extract<ToContent, { type: "action" }>["action"]

interface EditCtx {
  info: ElementInfo
  /** Send a style value now. Supersedes a queued preview of the same property. */
  set: (prop: StyleProp, value: string) => void
  /**
   * Live preview while dragging (colour picker, slider): at most one message per animation frame per property, the
   * latest value wins. The last value always goes out: next frame, or sooner via `set` / unmount.
   */
  preview: (prop: StyleProp, value: string) => void
  setText: (text: string) => void
  act: (action: Action) => void
}

const Ctx = createContext<EditCtx | null>(null)

export function useEdit(): EditCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error("useEdit must be used inside <EditProvider>")
  return v
}

/** At most one `emit` per frame per property (latest value wins); `flush` emits what is queued right now. */
function createPreviewQueue(first: (prop: StyleProp, value: string) => void) {
  let emit = first
  const queued = new Map<StyleProp, string>()
  let frame = 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    const all = [...queued]
    queued.clear()
    for (const [prop, value] of all) emit(prop, value)
  }
  return {
    add(prop: StyleProp, value: string) {
      queued.set(prop, value)
      frame ||= requestAnimationFrame(flush)
    },
    drop: (prop: StyleProp) => void queued.delete(prop),
    flush,
    /** Later flushes go through the newest sender. */
    setEmit(next: (prop: StyleProp, value: string) => void) {
      emit = next
    },
  }
}

/**
 * Everything the fields below send is addressed to `info.el`, the element they were rendered for: the page applies
 * it to THAT element even when another one is selected by the time the message arrives. The scope is keyed by
 * element, so a selection change unmounts every field; whatever was half-typed or queued is flushed on the way out
 * (see useSettleOnUnmount), still carrying the old id.
 */
export function EditProvider(props: {
  info: ElementInfo
  send: (m: ToContent) => void
  children: ReactNode
}) {
  return <Scope key={props.info.el} {...props} />
}

function Scope({
  info,
  send,
  children,
}: {
  info: ElementInfo
  send: (m: ToContent) => void
  children: ReactNode
}) {
  const { el } = info
  const emit = (prop: StyleProp, value: string) =>
    send({ type: "setStyle", el, prop, value })
  // The queue outlives renders but must always use the newest `send`.
  const [queue] = useState(() => createPreviewQueue(emit))
  useEffect(() => {
    queue.setEmit(emit)
  })
  // Leaving the element (or the tab): a preview that has not had its frame yet must still reach the page.
  useEffect(() => queue.flush, [queue])

  const ctx: EditCtx = {
    info,
    set: (prop, value) => {
      queue.drop(prop)
      send({ type: "setStyle", el, prop, value })
    },
    preview: queue.add,
    setText: (text) => send({ type: "setText", el, text }),
    act: (action) => send({ type: "action", el, action }),
  }
  return <Ctx value={ctx}>{children}</Ctx>
}

/**
 * Text shown by an input that the user types into while the panel state keeps being re-pushed.
 *  - `draft`: what the user is typing (uncommitted). Survives state pushes, so we never fight the caret.
 *  - `pending`: what we last committed, shown until the next state push echoes it back (or doesn't, if
 *    the page rejected the value, in which case the field falls back to the real value).
 * `token` must change identity on every pushed state (selection.styles / the ElementInfo do).
 */
export function useDraft(value: string, token: unknown) {
  const [draft, setDraft] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [seen, setSeen] = useState(token)
  if (seen !== token) {
    setSeen(token)
    setPending(null)
  }
  const current = pending ?? value
  return {
    text: draft ?? current,
    /** Last known value of the property (committed or from the page). Compare commits against this. */
    current,
    typing: draft !== null,
    type: setDraft,
    cancel: () => setDraft(null),
    commit: (next: string) => {
      setDraft(null)
      setPending(next)
    },
  }
}

export type Draft = ReturnType<typeof useDraft>

/**
 * Commit a half-typed field when it goes away. The page swallows the click that selects another element, so the
 * focused input never blurs: without this the draft would be lost when the panel moves on to the new element.
 */
export function useSettleOnUnmount(d: Draft, commit: (text: string) => void) {
  const latest = useRef({ d, commit })
  useEffect(() => {
    latest.current = { d, commit }
  })
  useEffect(
    () => () => {
      const { d, commit } = latest.current
      if (d.typing) commit(d.text)
    },
    []
  )
}

/** useDraft wired to one style property. `display` maps the computed value to what the field shows. */
export function useStyleDraft(
  prop: StyleProp,
  display: (v: string) => string = (v) => v
) {
  const { info, set, preview } = useEdit()
  const d = useDraft(display(info.styles[prop] ?? ""), info.styles)
  return {
    d,
    set: (v: string) => set(prop, v),
    preview: (v: string) => preview(prop, v),
  }
}
