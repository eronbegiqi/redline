import { useEffect, useId, useRef } from "react"

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"

import { useDraft, useEdit, useSettleOnUnmount } from "./edit-context"

const DEBOUNCE_MS = 300
// ElementInfo.text is cut at 2000 chars: writing a cut copy back would silently delete the rest.
const TEXT_CAP = 2000

/** Text of a text-leaf element. Sends `setText` 300ms after the last keystroke, and on blur. */
export function TextField() {
  const id = useId()
  const { info, setText } = useEdit()
  const d = useDraft(info.text, info)
  const timer = useRef<number>(0)
  const latest = useRef(d)
  useEffect(() => {
    latest.current = d
  })
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const flush = (text: string) => {
    window.clearTimeout(timer.current)
    const cur = latest.current
    if (text === cur.current) return cur.cancel()
    cur.commit(text)
    setText(text)
  }
  // The page swallows the click that selects another element, so this textarea never blurs: settle on unmount.
  useSettleOnUnmount(d, flush)
  const tooLong = info.text.length >= TEXT_CAP

  return (
    <Field>
      <FieldLabel
        htmlFor={id}
        className="text-xs font-normal text-muted-foreground"
      >
        Text
      </FieldLabel>
      <Textarea
        id={id}
        value={d.text}
        disabled={tooLong}
        className="max-h-40 min-h-14 text-xs md:text-xs"
        onChange={(e) => {
          const text = e.target.value
          d.type(text)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => flush(text), DEBOUNCE_MS)
        }}
        onBlur={() => latest.current.typing && flush(latest.current.text)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return
          window.clearTimeout(timer.current)
          d.cancel()
        }}
      />
      {tooLong && (
        <FieldDescription className="text-xs">
          Too long to edit here.
        </FieldDescription>
      )}
    </Field>
  )
}
