import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyPlusIcon,
  EyeOffIcon,
  Trash2Icon,
} from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ToContent } from "@/shared/protocol"
import type { SourceHint } from "@/shared/types"

import { useEdit } from "./edit-context"

const FRAMEWORKS: Record<SourceHint["framework"], string> = {
  react: "React",
  vue: "Vue",
  svelte: "Svelte",
}

function sourceLabel(s: SourceHint) {
  const name = FRAMEWORKS[s.framework]
  const component = s.component ?? s.chain?.[0]
  return component ? `${name} · ${component}` : name
}

function sourceTitle(s: SourceHint) {
  const where = s.file ? `${s.file}${s.line ? `:${s.line}` : ""}` : ""
  return (
    [s.chain?.join(" › "), where].filter(Boolean).join("\n") || sourceLabel(s)
  )
}

/** A Badge that truncates instead of overflowing the 360px column (long class names, long ids). */
function Chip({
  children,
  title,
  variant,
}: {
  children: string
  title?: string
  variant: "default" | "secondary" | "outline"
}) {
  return (
    <Badge variant={variant} title={title ?? children} className="max-w-full">
      <span className="truncate">{children}</span>
    </Badge>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function ElementCard() {
  const { info, send } = useEdit()
  const { descriptor: d, rect } = info
  const act =
    (action: Extract<ToContent, { type: "action" }>["action"]) => () =>
      send({ type: "action", action })

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="truncate" title={d.text}>
          {d.text || <span className="font-mono">{`<${d.tag}>`}</span>}
        </CardTitle>
        <CardDescription
          className="truncate font-mono text-xs"
          title={d.selector}
        >
          {d.selector}
        </CardDescription>
        <CardAction className="flex gap-1">
          <IconButton
            label="Select parent"
            disabled={!info.hasParent}
            onClick={act("parent")}
          >
            <ArrowUpIcon />
          </IconButton>
          <IconButton
            label="Select first child"
            disabled={!info.hasChild}
            onClick={act("child")}
          >
            <ArrowDownIcon />
          </IconButton>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1">
        <Chip variant="default">{d.tag}</Chip>
        {d.id && <Chip variant="secondary">{`#${d.id}`}</Chip>}
        {d.classes.map((c) => (
          <Chip key={c} variant="outline">{`.${c}`}</Chip>
        ))}
        {d.source && (
          <Chip variant="secondary" title={sourceTitle(d.source)}>
            {sourceLabel(d.source)}
          </Chip>
        )}
        <Chip variant="outline">{`${Math.round(rect.width)} × ${Math.round(rect.height)}`}</Chip>
      </CardContent>
      <CardFooter className="gap-2 p-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!info.canDelete}
          onClick={act("duplicate")}
        >
          <CopyPlusIcon data-icon="inline-start" />
          Duplicate
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!info.canDelete}
          onClick={act("hide")}
        >
          <EyeOffIcon data-icon="inline-start" />
          Hide
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="flex-1"
          disabled={!info.canDelete}
          onClick={act("delete")}
        >
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
      </CardFooter>
    </Card>
  )
}
