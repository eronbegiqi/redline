import { MousePointerClickIcon } from "lucide-react"
import { useState } from "react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { TabProps } from "@/panel/props"

import { EditProvider } from "./edit/edit-context"
import { ElementCard } from "./edit/ElementCard"
import {
  AppearanceGroup,
  SizeGroup,
  SpacingGroup,
  TypographyGroup,
} from "./edit/groups"
import { TextField } from "./edit/TextField"

const GROUPS = [
  ["typography", "Typography", TypographyGroup],
  ["spacing", "Spacing", SpacingGroup],
  ["size", "Size & layout", SizeGroup],
  ["appearance", "Appearance", AppearanceGroup],
] as const

export function EditTab({ state, send }: TabProps) {
  // Lives above the keyed provider so the open groups survive a change of selection.
  const [open, setOpen] = useState<string[]>(["typography", "spacing"])
  const info = state.selection

  if (!info) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MousePointerClickIcon />
          </EmptyMedia>
          <EmptyTitle>Click anything on the page</EmptyTitle>
          <EmptyDescription>
            {state.mode === "select"
              ? "Pick an element to edit its text and styles."
              : "Switch to Select mode to pick an element."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <TooltipProvider>
      {/* shrink-0: the Card is overflow-hidden, so as a shrinkable flex item it would be squashed instead of scrolling.
          contain-inline-size: Radix ScrollArea wraps its content in `display: table`, which would otherwise grow to
          fit the longest selector/class name instead of letting it truncate. */}
      <div className="flex h-full flex-col gap-3 overflow-x-hidden overflow-y-auto p-3 contain-inline-size *:min-w-0 *:shrink-0">
        <EditProvider key={info.el} info={info} send={send}>
          <ElementCard />
          {info.isTextLeaf && <TextField />}
          <Accordion type="multiple" value={open} onValueChange={setOpen}>
            {GROUPS.map(([value, title, Group]) => (
              <AccordionItem key={value} value={value}>
                <AccordionTrigger className="px-1">{title}</AccordionTrigger>
                <AccordionContent>
                  <Group />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </EditProvider>
      </div>
    </TooltipProvider>
  )
}
