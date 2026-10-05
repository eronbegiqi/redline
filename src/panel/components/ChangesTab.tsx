import { useRef, useState } from "react"
import {
  CopyPlusIcon,
  HashIcon,
  HistoryIcon,
  MoveIcon,
  PaintbrushIcon,
  RotateCcwIcon,
  TagIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { TabProps } from "@/panel/props"
import { summarize } from "@/panel/summarize"
import type { Change } from "@/shared/types"

/** Result of buildExport, computed once in App so the footer button and the preview agree. */
export type Prompt = { text: string } | { error: string }

interface Props extends TabProps {
  note: string
  onNoteChange: (note: string) => void
  prompt: Prompt
}

const KIND: Record<Change["kind"], { Icon: LucideIcon; label: string }> = {
  style: { Icon: PaintbrushIcon, label: "Style" },
  text: { Icon: TypeIcon, label: "Text" },
  attr: { Icon: TagIcon, label: "Attribute" },
  class: { Icon: HashIcon, label: "Class" },
  move: { Icon: MoveIcon, label: "Move" },
  delete: { Icon: Trash2Icon, label: "Delete" },
  insert: { Icon: CopyPlusIcon, label: "Insert" },
}

export function ChangesTab({ state, send, note, onNoteChange, prompt }: Props) {
  const { changes } = state

  if (!changes.length) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HistoryIcon />
          </EmptyMedia>
          <EmptyTitle>No changes yet</EmptyTitle>
          <EmptyDescription>
            Edit something on the page and it will be listed here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Radix wraps viewport content in a display:table div that grows to the widest child; force block so `truncate` works. */}
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
        <ItemGroup className="gap-0.5 p-2">
          {changes.map((c) => (
            <ChangeRow
              key={c.id}
              change={c}
              onRevert={() => send({ type: "revert", id: c.id })}
            />
          ))}
        </ItemGroup>
      </ScrollArea>

      <FieldGroup className="max-h-[60%] shrink-0 gap-3 overflow-y-auto border-t p-3">
        <Field>
          <FieldLabel
            htmlFor="redline-note"
            className="text-xs text-muted-foreground"
          >
            Notes for the AI (optional)
          </FieldLabel>
          <Textarea
            id="redline-note"
            rows={2}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="e.g. Use the existing Button component, keep it responsive."
            className="min-h-14 text-xs"
          />
        </Field>

        <Accordion type="single" collapsible>
          <AccordionItem value="preview" className="border-b-0">
            <AccordionTrigger className="py-0 text-xs text-muted-foreground">
              Preview prompt
            </AccordionTrigger>
            <AccordionContent className="pt-2 pb-0">
              <Textarea
                readOnly
                aria-label="Prompt preview"
                value={
                  "text" in prompt
                    ? prompt.text
                    : `Preview unavailable: ${prompt.error}`
                }
                className="max-h-48 min-h-20 font-mono text-xs"
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <RevertAll
          count={changes.length}
          onConfirm={() => send({ type: "revertAll" })}
        />
      </FieldGroup>
    </div>
  )
}

function ChangeRow({
  change: c,
  onRevert,
}: {
  change: Change
  onRevert: () => void
}) {
  const { Icon, label } = KIND[c.kind]
  return (
    <Item
      size="xs"
      role="listitem"
      className="flex-nowrap items-start py-1.5 hover:bg-muted/50"
    >
      <ItemMedia variant="icon" className="mt-0.5 text-muted-foreground">
        <Icon aria-hidden />
        <span className="sr-only">{label}</span>
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle
          className="flex w-full min-w-0 font-mono text-xs"
          title={c.target.selector}
        >
          {/* rtl puts the ellipsis on the left so the leaf end of long selectors stays visible; the ltr <bdi> keeps the
              characters in reading order (a leading "#" or a trailing ")" would otherwise jump to the other side). */}
          <span className="truncate text-left [direction:rtl]">
            <bdi dir="ltr">{c.target.selector}</bdi>
          </span>
        </ItemTitle>
        <ItemDescription className="truncate" title={summarize(c)}>
          {summarize(c)}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0 gap-1">
        {c.origin === "devtools" && <Badge variant="outline">DevTools</Badge>}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Revert this change"
              onClick={onRevert}
            >
              <Undo2Icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Revert this change</TooltipContent>
        </Tooltip>
      </ItemActions>
    </Item>
  )
}

/** Two-step inline confirm: reverting everything is not undoable. */
function RevertAll({
  count,
  onConfirm,
}: {
  count: number
  onConfirm: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)

  if (!confirming) {
    return (
      <Button
        ref={trigger}
        variant="outline"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        <RotateCcwIcon data-icon="inline-start" />
        Revert all
      </Button>
    )
  }
  return (
    <div
      role="group"
      aria-label="Confirm revert all"
      className="flex items-center gap-2"
    >
      <span className="min-w-0 flex-1 text-xs">
        Revert all {count} {count === 1 ? "change" : "changes"}?
      </span>
      {/* Cancel is focused first so a stray Enter cannot discard everything. */}
      <Button
        autoFocus
        variant="ghost"
        size="sm"
        onClick={() => {
          setConfirming(false)
          requestAnimationFrame(() => trigger.current?.focus())
        }}
      >
        Cancel
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          setConfirming(false)
          onConfirm()
        }}
      >
        Revert all
      </Button>
    </div>
  )
}
