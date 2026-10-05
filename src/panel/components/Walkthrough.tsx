import { useEffect, useState } from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClipboardCopyIcon,
  HandIcon,
  MousePointer2Icon,
  MoveIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const STORAGE_KEY = "redline.walkthrough.v1"

/** The panel lives on the extension origin, so this survives across every site. Storage can be blocked: never throw. */
export function hasSeenWalkthrough(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

function markSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, "1")
  } catch {
    /* private mode etc.: the tour just shows again next time */
  }
}

const STEPS: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: MousePointer2Icon,
    title: "Select anything",
    body: "Hover to preview, click to select. Double-click a piece of text to edit it right on the page. Use the arrows in the Edit tab to reach a parent or child element.",
  },
  {
    Icon: SlidersHorizontalIcon,
    title: "Tweak it",
    body: "Change text, colours, spacing, size and borders in the Edit tab. Drag the handles on the selection to resize. Duplicate, hide or delete with the buttons.",
  },
  {
    Icon: MoveIcon,
    title: "Drag & drop, or just browse",
    body: "Switch to Drag & drop to reorder elements or move them into another container. Switch to Browse (the hand) to use the page normally, for example to open a menu, then switch back.",
  },
  {
    Icon: ClipboardCopyIcon,
    title: "Copy it for your AI",
    body: "Every change is logged under Changes, and you can revert any row. Turn on DevTools to also record edits you make in Chrome DevTools. Then click Copy for AI and paste the prompt into your coding assistant. Reloading the tab clears your edits.",
  },
]

export function Walkthrough({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const last = step === STEPS.length - 1
  const { Icon, title, body } = STEPS[step]

  const close = () => {
    markSeen()
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
      else if (e.key === "ArrowRight")
        setStep((s) => Math.min(s + 1, STEPS.length - 1))
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close only closes over onClose
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Redline walkthrough"
      className="absolute inset-0 z-20 flex items-center bg-background/80 p-3 backdrop-blur-sm"
    >
      <Card className="w-full">
        <CardHeader>
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground [&_svg]:size-4">
            <Icon />
          </span>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              aria-label={`Step ${i + 1}: ${s.title}`}
              aria-current={i === step}
              onClick={() => setStep(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30"
              }`}
            />
          ))}
        </CardContent>
        <CardFooter className="justify-between">
          <Button variant="ghost" size="sm" onClick={close}>
            {last ? "Close" : "Skip"}
          </Button>
          <div className="flex gap-1.5">
            {step > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep(step - 1)}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Back
              </Button>
            )}
            <Button size="sm" onClick={last ? close : () => setStep(step + 1)}>
              {last ? (
                <>
                  <HandIcon data-icon="inline-start" />
                  Start editing
                </>
              ) : (
                <>
                  Next
                  <ArrowRightIcon data-icon="inline-end" />
                </>
              )}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
