import { useEffect, useMemo, useRef, useState } from "react"
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { copyText, usePanel } from "@/panel/bridge"
import { ChangesTab, type Prompt } from "@/panel/components/ChangesTab"
import { EditTab } from "@/panel/components/EditTab"
import { Header } from "@/panel/components/Header"
import { Walkthrough, hasSeenWalkthrough } from "@/panel/components/Walkthrough"
import {
  isPlaceholder,
  loadComments,
  placeholderEl,
  saveComments,
} from "@/panel/comments"
import { buildExport } from "@/shared/export"
import type { Descriptor, ElementComment, PanelState } from "@/shared/types"

function makePrompt(
  { changes, page }: PanelState,
  note: string,
  comments: ElementComment[],
  slim: boolean
): Prompt {
  try {
    return {
      text: buildExport(changes, { page, note: note.trim(), comments, slim }),
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export const CONNECT_TIMEOUT_MS = 5000

/** First paint until the page pushes a state; after 5s it says what to do instead of spinning for ever. */
function Connecting() {
  const [late, setLate] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setLate(true), CONNECT_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <div
      role="status"
      className="flex h-svh items-center justify-center p-6 text-center text-sm text-muted-foreground"
    >
      {late
        ? "Couldn't reach the page. Reload the tab and click the Redline icon again."
        : "Connecting to page…"}
    </div>
  )
}

export function App() {
  const { state, send } = usePanel()
  const [note, setNote] = useState("")
  const [tour, setTour] = useState(() => !hasSeenWalkthrough())
  const [comments, setComments] = useState<Record<string, ElementComment>>({})
  const latest = useRef(comments)
  const [slim, setSlim] = useState(true)
  const url = state?.page.url
  const list = useMemo(() => Object.values(comments), [comments])
  const prompt = useMemo(
    () => (state ? makePrompt(state, note, list, slim) : { error: "no state" }),
    [state, note, list, slim]
  )

  // Every change to the comments goes through here so it is also saved for the next visit to this page.
  const update = (
    fn: (prev: Record<string, ElementComment>) => Record<string, ElementComment>
  ) => {
    const next = fn(latest.current)
    if (next === latest.current) return
    latest.current = next
    setComments(next)
    if (url) saveComments(url, Object.values(next))
  }
  // Empty text drops the comment.
  const onComment = (el: string, target: Descriptor, text: string) =>
    update((prev) => {
      const next = { ...prev }
      if (text.trim()) next[el] = { el, target, text }
      else delete next[el]
      return next
    })

  // Restore what was saved for this page (placeholder ids until the element is selected again).
  useEffect(() => {
    if (!url) return
    const saved = loadComments(url)
    if (saved.length)
      update((prev) => ({
        ...Object.fromEntries(saved.map((c) => [c.el, c])),
        ...prev,
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page
  }, [url])

  // Selecting an element that has a restored comment binds the comment to its live id.
  const selected = state?.selection
  useEffect(() => {
    if (!selected) return
    const placeholder = placeholderEl(selected.descriptor.selector)
    update((prev) =>
      !prev[placeholder] || prev[selected.el]
        ? prev
        : Object.fromEntries(
            Object.entries(prev).map(([k, c]) =>
              k === placeholder
                ? [selected.el, { ...c, el: selected.el }]
                : [k, c]
            )
          )
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the selection only
  }, [selected?.el])

  // Pins on the page, numbered like the rows in the Changes tab.
  const connected = !!state
  useEffect(() => {
    if (!connected) return
    send({
      type: "markers",
      items: list.map((c, i) => ({
        n: i + 1,
        el: isPlaceholder(c.el) ? undefined : c.el,
        selector: c.target.selector,
      })),
    })
  }, [connected, list, send])

  if (!state) return <Connecting />

  const count = state.changes.length + list.length
  return (
    <TooltipProvider delayDuration={400}>
      <div className="relative flex h-svh flex-col bg-background text-foreground">
        <Header state={state} send={send} onHelp={() => setTour(true)} />

        <Tabs defaultValue="edit" className="min-h-0 flex-1 gap-0">
          <div className="shrink-0 px-3 py-2">
            <TabsList className="w-full">
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="changes">
                Changes
                {count > 0 && (
                  <Badge className="h-4 min-w-4 px-1 text-[10px]">
                    {count}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>
          {/* EditTab fills this box (h-full) and scrolls itself; overflow-y-auto here only catches a tab that doesn't. */}
          <TabsContent value="edit" className="min-h-0 overflow-y-auto">
            <EditTab
              state={state}
              send={send}
              comment={comments[state.selection?.el ?? ""]?.text}
              onComment={onComment}
            />
          </TabsContent>
          <TabsContent value="changes" className="flex min-h-0 flex-col">
            <ChangesTab
              state={state}
              send={send}
              note={note}
              onNoteChange={setNote}
              prompt={prompt}
              comments={list}
              onComment={onComment}
              slim={slim}
              onSlim={setSlim}
            />
          </TabsContent>
        </Tabs>

        {tour && <Walkthrough onClose={() => setTour(false)} />}

        <Footer
          disabled={!count || "error" in prompt}
          text={"text" in prompt ? prompt.text : ""}
          failed={count > 0 && "error" in prompt}
        />
      </div>
    </TooltipProvider>
  )
}

function Footer({
  text,
  disabled,
  failed,
}: {
  text: string
  disabled: boolean
  failed: boolean
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle")
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    setStatus((await copyText(text)) ? "copied" : "failed")
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setStatus("idle"), 2000)
  }

  return (
    <footer className="flex shrink-0 flex-col gap-2 border-t p-3">
      {failed && (
        <p
          role="status"
          className="flex items-center gap-1.5 text-xs text-destructive [&_svg]:size-3.5 [&_svg]:shrink-0"
        >
          <TriangleAlertIcon />
          Could not build the prompt. See Preview prompt in Changes.
        </p>
      )}
      <Button size="lg" disabled={disabled} onClick={copy} aria-live="polite">
        {status === "copied" ? (
          <CheckIcon data-icon="inline-start" />
        ) : (
          <CopyIcon data-icon="inline-start" />
        )}
        {status === "copied"
          ? "Copied"
          : status === "failed"
            ? "Copy failed"
            : "Copy for AI"}
      </Button>
    </footer>
  )
}

export default App
