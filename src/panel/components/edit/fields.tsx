import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react"
import { HexAlphaColorPicker } from "react-colorful"
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  LinkIcon,
  UnlinkIcon,
} from "lucide-react"

import { Field, FieldLabel, FieldSet, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { StyleProp } from "@/shared/types"

import {
  canonColor,
  emitColor,
  formatColor,
  formatNumber,
  normalizeLength,
  pickerHex,
  sameValue,
  stepValue,
} from "./css"
import {
  useEdit,
  useSettleOnUnmount,
  useStyleDraft,
  type Draft,
} from "./edit-context"

// Dense 360px layout: labels and inputs are one size down from shadcn's defaults.
// `md:text-xs` is needed because Input/Textarea set `md:text-sm` (never active in a 360px frame, but cn() keeps both).
const LABEL = "text-xs font-normal text-muted-foreground"
const INPUT = "h-7 px-2 text-xs md:text-xs"

/** Shared text-input behaviour: Enter/blur commit, Escape reverts, optional ArrowUp/Down stepping. */
function textInputProps(
  d: Draft,
  commit: (text: string) => void,
  onStep?: (dir: 1 | -1, e: KeyboardEvent<HTMLInputElement>) => void
) {
  return {
    value: d.text,
    spellCheck: false,
    autoComplete: "off",
    onChange: (e: ChangeEvent<HTMLInputElement>) => d.type(e.target.value),
    onBlur: () => {
      if (d.typing) commit(d.text)
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return
      if (e.key === "Enter") commit(d.text)
      else if (e.key === "Escape") d.cancel()
      else if (onStep && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault()
        onStep(e.key === "ArrowUp" ? 1 : -1, e)
      }
    },
  }
}

// ---- length -------------------------------------------------------------------------------------

interface LengthOpts {
  /** Bare numbers stay unitless (line-height) instead of becoming px. */
  unitless?: boolean
  step?: number
  /** ArrowUp/Down can start from the keyword `normal` (letter-spacing, gap). */
  zero?: boolean
  /** Override what a commit does / when it is a no-op (linked padding/margin sides). */
  apply?: (next: string) => void
  noop?: (next: string) => boolean
}

function useLengthInput(prop: StyleProp, o: LengthOpts = {}) {
  const { d, set } = useStyleDraft(prop)
  const commit = (raw: string) => {
    const next = normalizeLength(raw, o.unitless)
    // An empty field is "never mind", not "remove the inline style": we can't tell whether one exists.
    if (next === "" || (o.noop ? o.noop(next) : sameValue(next, d.current)))
      return d.cancel()
    d.commit(next)
    ;(o.apply ?? set)(next)
  }
  useSettleOnUnmount(d, commit)
  return textInputProps(d, commit, (dir, e) => {
    const next = stepValue(normalizeLength(d.text, o.unitless), dir, {
      step: o.step,
      shift: e.shiftKey,
      alt: e.altKey,
      zero: o.zero,
    })
    if (next) commit(next)
  })
}

export function LengthField({
  prop,
  label,
  ...opts
}: LengthOpts & { prop: StyleProp; label: string }) {
  const id = useId()
  const input = useLengthInput(prop, opts)
  return (
    <Field>
      <FieldLabel htmlFor={id} className={LABEL}>
        {label}
      </FieldLabel>
      <Input id={id} className={INPUT} {...input} />
    </Field>
  )
}

/** Free-text property (font-family): commits as typed, no length normalising or stepping. */
export function TextStyleField({
  prop,
  label,
}: {
  prop: StyleProp
  label: string
}) {
  const id = useId()
  const { d, set } = useStyleDraft(prop)
  const commit = (text: string) => {
    const next = text.trim()
    if (next === "" || sameValue(next, d.current)) return d.cancel()
    d.commit(next)
    set(next)
  }
  useSettleOnUnmount(d, commit)
  return (
    <Field>
      <FieldLabel htmlFor={id} className={LABEL}>
        {label}
      </FieldLabel>
      <Input id={id} className={INPUT} {...textInputProps(d, commit)} />
    </Field>
  )
}

const SIDES = [
  ["top", "T"],
  ["right", "R"],
  ["bottom", "B"],
  ["left", "L"],
] as const

function SideInput({
  prop,
  letter,
  title,
  group,
  linked,
}: {
  prop: StyleProp
  letter: string
  title: string
  group: StyleProp[]
  linked: boolean
}) {
  const { info, set } = useEdit()
  const input = useLengthInput(
    prop,
    linked
      ? {
          apply: (next) =>
            group.forEach(
              (p) => !sameValue(info.styles[p], next) && set(p, next)
            ),
          noop: (next) => group.every((p) => sameValue(info.styles[p], next)),
        }
      : {}
  )
  return (
    <InputGroup className="h-7">
      <InputGroupAddon>
        <InputGroupText className="text-[10px]">{letter}</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        aria-label={title}
        className="px-1 text-xs md:text-xs"
        {...input}
      />
    </InputGroup>
  )
}

/** padding / margin: four sides plus a link toggle that writes one edit to all of them. */
export function SidesField({
  kind,
  label,
}: {
  kind: "padding" | "margin"
  label: string
}) {
  const id = useId()
  const { info } = useEdit()
  const group = SIDES.map(([side]) => `${kind}-${side}` as const)
  const [linked, setLinked] = useState(() =>
    group.every((p) => sameValue(info.styles[p], info.styles[group[0]]))
  )
  return (
    <FieldSet className="gap-1.5">
      <div className="flex items-center justify-between">
        <FieldTitle id={id} className={LABEL}>
          {label}
        </FieldTitle>
        <Toggle
          size="sm"
          pressed={linked}
          onPressedChange={setLinked}
          aria-label={`Link all ${kind} sides`}
          className="size-6 min-w-6 px-0"
        >
          {linked ? <LinkIcon /> : <UnlinkIcon />}
        </Toggle>
      </div>
      <div
        role="group"
        aria-labelledby={id}
        className="grid grid-cols-4 gap-1.5"
      >
        {SIDES.map(([side, letter]) => (
          <SideInput
            key={side}
            prop={`${kind}-${side}`}
            letter={letter}
            title={`${label} ${side}`}
            group={group}
            linked={linked}
          />
        ))}
      </div>
    </FieldSet>
  )
}

// ---- colour -------------------------------------------------------------------------------------

export function ColorField({
  prop,
  label,
}: {
  prop: StyleProp
  label: string
}) {
  const id = useId()
  const { d, set, preview } = useStyleDraft(prop, formatColor)

  const commit = (text: string) => {
    const next = emitColor(text)
    if (next === "" || canonColor(next) === canonColor(d.current))
      return d.cancel()
    d.commit(formatColor(next))
    set(next)
  }
  useSettleOnUnmount(d, commit)
  // Live preview while dragging: the field text follows the picker (as a draft, so state echoes can't
  // yank it back) and the page follows at most once per frame (the latest value always arrives).
  // Closing the popover settles the draft with a final, immediate send.
  const pick = (hex: string) => {
    const next = emitColor(hex)
    d.type(formatColor(next))
    preview(next)
  }

  return (
    <Field>
      <FieldLabel htmlFor={id} className={LABEL}>
        {label}
      </FieldLabel>
      <Popover onOpenChange={(open) => !open && d.typing && commit(d.text)}>
        <InputGroup className="h-7">
          <InputGroupAddon>
            <PopoverTrigger asChild>
              <InputGroupButton
                size="icon-xs"
                aria-label={`Pick ${label.toLowerCase()}`}
              >
                {/* checkerboard under the swatch so transparent colours are visible */}
                <span className="size-4 overflow-hidden rounded-sm bg-[repeating-conic-gradient(var(--muted-foreground)_0%_25%,var(--background)_0%_50%)] bg-[length:6px_6px] ring-1 ring-foreground/20">
                  <span
                    className="block size-full"
                    style={{ backgroundColor: d.text }}
                  />
                </span>
              </InputGroupButton>
            </PopoverTrigger>
          </InputGroupAddon>
          <InputGroupInput
            id={id}
            className="px-1 text-xs md:text-xs"
            {...textInputProps(d, commit)}
          />
        </InputGroup>
        <PopoverContent align="start" className="w-56 p-3">
          <HexAlphaColorPicker
            color={pickerHex(d.text)}
            onChange={pick}
            style={{ width: "100%", height: 150 }}
            className="[&_[class$=pointer]]:size-4!"
          />
        </PopoverContent>
      </Popover>
    </Field>
  )
}

// ---- select / toggle / slider -------------------------------------------------------------------

export type Option = readonly [value: string, label: string]

export function SelectField({
  prop,
  label,
  options,
}: {
  prop: StyleProp
  label: string
  options: readonly Option[]
}) {
  const id = useId()
  const { d, set } = useStyleDraft(prop)
  const value = d.text
  // Computed values outside our list ("list-item", "450", "solid none none none") still need an item to show.
  const items =
    !value || options.some(([v]) => v === value)
      ? options
      : [...options, [value, value] as const]
  return (
    <Field>
      <FieldLabel htmlFor={id} className={LABEL}>
        {label}
      </FieldLabel>
      <Select
        value={value}
        onValueChange={(v) => {
          if (sameValue(v, d.current)) return
          d.commit(v)
          set(v)
        }}
      >
        <SelectTrigger id={id} size="sm" className="w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map(([v, l]) => (
              <SelectItem key={v} value={v} className="text-xs">
                {l}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

const ALIGNS = [
  ["left", AlignLeftIcon],
  ["center", AlignCenterIcon],
  ["right", AlignRightIcon],
  ["justify", AlignJustifyIcon],
] as const

export function AlignField() {
  const id = useId()
  const { d, set } = useStyleDraft("text-align")
  return (
    <Field>
      <FieldTitle id={id} className={LABEL}>
        Align
      </FieldTitle>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        aria-labelledby={id}
        value={d.text}
        onValueChange={(v) => {
          // Radix reports "" when the pressed item is clicked again: keep the current value.
          if (!v || sameValue(v, d.current)) return
          d.commit(v)
          set(v)
        }}
      >
        {ALIGNS.map(([v, Icon]) => (
          <ToggleGroupItem key={v} value={v} aria-label={`Align ${v}`}>
            <Icon />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  )
}

export function OpacityField() {
  const id = useId()
  const { d, set, preview } = useStyleDraft("opacity")
  const box = useRef<HTMLDivElement>(null)
  const n = Number.parseFloat(d.text)
  const value = Number.isFinite(n) ? n : 1
  const shown = `${Math.round(value * 100)}%`
  useSettleOnUnmount(d, (text) => {
    d.commit(text)
    set(text)
  })
  // Radix puts no accessible name on the thumb (and Slider forwards props to the root only), so name it here.
  useEffect(() => {
    const thumb = box.current?.querySelector('[role="slider"]')
    thumb?.setAttribute("aria-labelledby", id)
    thumb?.setAttribute("aria-valuetext", shown)
  })
  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldTitle id={id} className={LABEL}>
          Opacity
        </FieldTitle>
        <span className="text-xs text-muted-foreground tabular-nums">
          {shown}
        </span>
      </div>
      <div ref={box}>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[value]}
          // Draft while dragging (echoes can't move the thumb back), previewed at most once per frame; the
          // release always sends the final value.
          onValueChange={([x]) => {
            const next = formatNumber(x)
            d.type(next)
            preview(next)
          }}
          onValueCommit={([x]) => {
            const next = formatNumber(x)
            d.commit(next)
            set(next)
          }}
        />
      </div>
    </Field>
  )
}
