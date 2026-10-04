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
import { buildExport } from "@/shared/export"
import type { PanelState } from "@/shared/types"

// The timestamp comes from the log (not the clock) so the preview and the copied text are identical.
function makePrompt({ changes, page }: PanelState, note: string): Prompt {
  try {
    const capturedAt = new Date(Math.max(0, ...changes.map((c) => c.at))).toISOString()
    return { text: buildExport(changes, { page, capturedAt, note: note.trim() }) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export function App() {
  const { state, send } = usePanel()
  const [note, setNote] = useState("")
  const prompt = useMemo(() => (state ? makePrompt(state, note) : { error: "no state" }), [state, note])

  if (!state) {
    return <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">Connecting to page…</div>
  }

  const count = state.changes.length
  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-svh flex-col bg-background text-foreground">
        <Header state={state} send={send} />

        <Tabs defaultValue="edit" className="min-h-0 flex-1 gap-0">
          <div className="shrink-0 px-3 py-2">
            <TabsList className="w-full">
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="changes">
                Changes
                {count > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{count}</Badge>}
              </TabsTrigger>
            </TabsList>
          </div>
          {/* EditTab fills this box (h-full) and scrolls itself; overflow-y-auto here only catches a tab that doesn't. */}
          <TabsContent value="edit" className="min-h-0 overflow-y-auto">
            <EditTab state={state} send={send} />
          </TabsContent>
          <TabsContent value="changes" className="flex min-h-0 flex-col">
            <ChangesTab state={state} send={send} note={note} onNoteChange={setNote} prompt={prompt} />
          </TabsContent>
        </Tabs>

        <Footer disabled={!count || "error" in prompt} text={"text" in prompt ? prompt.text : ""} failed={count > 0 && "error" in prompt} />
      </div>
    </TooltipProvider>
  )
}

function Footer({ text, disabled, failed }: { text: string; disabled: boolean; failed: boolean }) {
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
        <p role="status" className="flex items-center gap-1.5 text-xs text-destructive [&_svg]:size-3.5 [&_svg]:shrink-0">
          <TriangleAlertIcon />
          Could not build the prompt. See Preview prompt in Changes.
        </p>
      )}
      <Button size="lg" disabled={disabled} onClick={copy} aria-live="polite">
        {status === "copied" ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
        {status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Copy for AI"}
      </Button>
    </footer>
  )
}

export default App
