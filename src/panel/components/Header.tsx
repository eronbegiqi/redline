import { useRef, type PointerEvent } from "react"
import { HandIcon, MousePointer2Icon, MoveIcon, RulerIcon, XIcon, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { TabProps } from "@/panel/props"
import type { Mode } from "@/shared/types"

const MODES: { value: Mode; label: string; Icon: LucideIcon }[] = [
  { value: "select", label: "Select & edit", Icon: MousePointer2Icon },
  { value: "move", label: "Drag & drop", Icon: MoveIcon },
  { value: "browse", label: "Browse (use the page normally)", Icon: HandIcon },
]

const INTERACTIVE = "button, label, [role=radio], [role=switch]"

export function Header({ state, send }: TabProps) {
  const last = useRef<{ x: number; y: number } | null>(null)

  // Screen-space deltas: the frame moves under the pointer, so client coords would feed back on themselves.
  const down = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as Element).closest(INTERACTIVE)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    last.current = { x: e.screenX, y: e.screenY }
  }
  const move = (e: PointerEvent<HTMLElement>) => {
    const from = last.current
    if (!from) return
    const dx = e.screenX - from.x
    const dy = e.screenY - from.y
    if (!dx && !dy) return
    last.current = { x: e.screenX, y: e.screenY }
    send({ type: "moveFrame", dx, dy })
  }
  const end = () => {
    last.current = null
  }

  return (
    <header
      className="flex shrink-0 cursor-grab touch-none items-center gap-2 border-b px-3 py-2 select-none active:cursor-grabbing"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="flex items-center gap-1.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground [&_svg]:size-3.5">
          <RulerIcon />
        </span>
        <span className="text-sm font-semibold tracking-tight">Redline</span>
      </div>

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        aria-label="Mode"
        value={state.mode}
        // Radix emits "" when the active item is clicked again: a mode must always stay selected.
        onValueChange={(mode) => mode && send({ type: "setMode", mode: mode as Mode })}
        className="ml-auto"
      >
        {MODES.map(({ value, label, Icon }) => (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value={value}
                aria-label={label}
                // aria-checked, not data-state: TooltipTrigger overwrites data-state on its child.
                className="aria-checked:bg-primary aria-checked:text-primary-foreground"
              >
                <Icon />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>

      <Tooltip>
        <TooltipTrigger asChild>
          <Field orientation="horizontal" className="w-auto gap-1.5">
            <FieldLabel htmlFor="redline-devtools" className="cursor-pointer text-xs">
              DevTools
            </FieldLabel>
            <Switch
              id="redline-devtools"
              size="sm"
              checked={state.recording}
              onCheckedChange={(on) => send({ type: "setRecording", on })}
            />
          </Field>
        </TooltipTrigger>
        <TooltipContent>Also record edits made in Chrome DevTools (text, attributes, inline styles, added or removed nodes). Off by default.</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Close panel" onClick={() => send({ type: "close" })}>
            <XIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Close (edits stay on the page)</TooltipContent>
      </Tooltip>
    </header>
  )
}
