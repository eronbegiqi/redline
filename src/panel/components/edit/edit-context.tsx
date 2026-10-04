import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

import type { ToContent } from "@/shared/protocol"
import type { ElementInfo, StyleProp } from "@/shared/types"

interface EditCtx {
  info: ElementInfo
  send: (m: ToContent) => void
  set: (prop: StyleProp, value: string) => void
}

const Ctx = createContext<EditCtx | null>(null)

export function useEdit(): EditCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error("useEdit must be used inside <EditProvider>")
  return v
}

/**
 * Mount with `key={info.el}`: every field's draft state then resets when the selection changes.
 * `send` goes dead on unmount so a blur that fires while the old inputs are being torn down can
 * never apply an edit to the newly selected element (content applies setStyle/setText to "selected").
 */
export function EditProvider({
  info,
  send,
  children,
}: {
  info: ElementInfo
  send: (m: ToContent) => void
  children: ReactNode
}) {
  const alive = useRef(true)
  useLayoutEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const guarded = (m: ToContent) => {
    if (alive.current) send(m)
  }
  const set = (prop: StyleProp, value: string) =>
    guarded({ type: "setStyle", prop, value })
  return <Ctx value={{ info, send: guarded, set }}>{children}</Ctx>
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

/** useDraft wired to one style property. `display` maps the computed value to what the field shows. */
export function useStyleDraft(
  prop: StyleProp,
  display: (v: string) => string = (v) => v
) {
  const { info, set } = useEdit()
  const d = useDraft(display(info.styles[prop] ?? ""), info.styles)
  return { d, set: (v: string) => set(prop, v) }
}
