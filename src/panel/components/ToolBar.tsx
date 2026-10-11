import {
  BoxIcon,
  MousePointerClickIcon,
  RectangleHorizontalIcon,
  TypeIcon,
} from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { TabProps } from "@/panel/props"
import type { Tool } from "@/shared/types"

const TOOLS = [
  ["box", "Box", BoxIcon],
  ["text", "Text", TypeIcon],
  ["button", "Button", RectangleHorizontalIcon],
] as const

/** Context strip under the header for the two design modes. Nothing for the others. */
export function ToolBar({ state, send }: TabProps) {
  if (state.mode === "position")
    return (
      <p className="flex shrink-0 items-center gap-1.5 border-b px-3 py-1.5 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
        <MousePointerClickIcon />
        Drag an element to offset it. Shift locks the axis, arrow keys nudge
        (Shift = 10px).
      </p>
    )
  if (state.mode !== "draw") return null
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label="Element to draw"
        value={state.tool ?? "box"}
        onValueChange={(tool) =>
          tool && send({ type: "setTool", tool: tool as Tool })
        }
      >
        {TOOLS.map(([value, label, Icon]) => (
          <ToggleGroupItem
            key={value}
            value={value}
            className="gap-1 px-2 text-xs"
          >
            <Icon />
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <span className="text-xs text-muted-foreground">
        Drag on the page to draw.
      </span>
    </div>
  )
}
