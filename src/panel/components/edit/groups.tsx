import { useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"

import {
  AlignField,
  ColorField,
  LengthField,
  OpacityField,
  SelectField,
  SidesField,
  TextStyleField,
  type Option,
} from "./fields"
import { useEdit } from "./edit-context"

const opts = (values: string[]): Option[] => values.map((v) => [v, v])

const WEIGHTS: Option[] = [
  ["100", "100 Thin"],
  ["200", "200 Extra light"],
  ["300", "300 Light"],
  ["400", "400 Regular"],
  ["500", "500 Medium"],
  ["600", "600 Semibold"],
  ["700", "700 Bold"],
  ["800", "800 Extra bold"],
  ["900", "900 Black"],
]
const DISPLAYS = opts([
  "block",
  "inline",
  "inline-block",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "none",
])
const POSITIONS = opts(["static", "relative", "absolute", "fixed", "sticky"])
const OVERFLOWS = opts(["visible", "hidden", "scroll", "auto", "clip"])
const VISIBILITY = opts(["visible", "hidden", "collapse"])
const FONT_STYLES = opts(["normal", "italic", "oblique"])
const DECORATIONS = opts(["none", "underline", "overline", "line-through"])
const TRANSFORMS = opts(["none", "uppercase", "lowercase", "capitalize"])
const WHITE_SPACE = opts(["normal", "nowrap", "pre", "pre-wrap", "pre-line"])
const DIRECTIONS = opts(["row", "row-reverse", "column", "column-reverse"])
const WRAPS = opts(["nowrap", "wrap", "wrap-reverse"])
const JUSTIFY = opts([
  "normal",
  "flex-start",
  "center",
  "flex-end",
  "space-between",
  "space-around",
  "space-evenly",
])
const ALIGN = opts([
  "normal",
  "stretch",
  "flex-start",
  "center",
  "flex-end",
  "baseline",
])
const ALIGN_SELF = opts(["auto", ...ALIGN.map(([v]) => v).slice(1)])
const BOX_SIZING = opts(["content-box", "border-box"])
const OBJECT_FIT = opts(["fill", "contain", "cover", "none", "scale-down"])
const CURSORS = opts([
  "auto",
  "default",
  "pointer",
  "text",
  "move",
  "grab",
  "not-allowed",
  "crosshair",
  "wait",
  "help",
])
const POINTER_EVENTS = opts(["auto", "none"])
const BORDER_STYLES = opts(["none", "solid", "dashed", "dotted", "double"])

function Group({ children }: { children: ReactNode }) {
  return <FieldGroup className="gap-3 px-1 pb-1">{children}</FieldGroup>
}
const Row = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-2 gap-2">{children}</div>
)

export function TypographyGroup() {
  return (
    <Group>
      <TextStyleField prop="font-family" label="Font family" />
      <Row>
        <ColorField prop="color" label="Colour" />
        <LengthField prop="font-size" label="Size" />
      </Row>
      <Row>
        <SelectField prop="font-weight" label="Weight" options={WEIGHTS} />
        <LengthField prop="line-height" label="Line height" unitless />
      </Row>
      <Row>
        <LengthField
          prop="letter-spacing"
          label="Letter spacing"
          step={0.1}
          zero
        />
        <AlignField />
      </Row>
      <Row>
        <SelectField prop="font-style" label="Style" options={FONT_STYLES} />
        <SelectField
          prop="text-decoration-line"
          label="Decoration"
          options={DECORATIONS}
        />
      </Row>
      <Row>
        <SelectField
          prop="text-transform"
          label="Transform"
          options={TRANSFORMS}
        />
        <SelectField
          prop="white-space"
          label="Wrapping"
          options={WHITE_SPACE}
        />
      </Row>
    </Group>
  )
}

export function SpacingGroup() {
  return (
    <Group>
      <SidesField kind="padding" label="Padding" />
      <SidesField kind="margin" label="Margin" />
      <Row>
        <LengthField prop="gap" label="Gap" zero />
      </Row>
    </Group>
  )
}

export function SizeGroup() {
  return (
    <Group>
      <Row>
        <LengthField prop="width" label="Width" />
        <LengthField prop="height" label="Height" />
      </Row>
      <Row>
        <LengthField prop="min-width" label="Min width" />
        <LengthField prop="min-height" label="Min height" />
      </Row>
      <Row>
        <LengthField prop="max-width" label="Max width" />
        <LengthField prop="max-height" label="Max height" />
      </Row>
      <Row>
        <SelectField
          prop="box-sizing"
          label="Box sizing"
          options={BOX_SIZING}
        />
        <SelectField
          prop="object-fit"
          label="Object fit"
          options={OBJECT_FIT}
        />
      </Row>
      <TextStyleField prop="aspect-ratio" label="Aspect ratio" />
    </Group>
  )
}

export function LayoutGroup() {
  return (
    <Group>
      <Row>
        <SelectField prop="display" label="Display" options={DISPLAYS} />
        <SelectField prop="position" label="Position" options={POSITIONS} />
      </Row>
      <Row>
        <LengthField prop="top" label="Top" />
        <LengthField prop="right" label="Right" />
      </Row>
      <Row>
        <LengthField prop="bottom" label="Bottom" />
        <LengthField prop="left" label="Left" />
      </Row>
      <Row>
        <LengthField prop="z-index" label="Z-index" unitless />
        <SelectField prop="overflow" label="Overflow" options={OVERFLOWS} />
      </Row>
      <Row>
        <SelectField
          prop="visibility"
          label="Visibility"
          options={VISIBILITY}
        />
      </Row>
    </Group>
  )
}

export function FlexGroup() {
  return (
    <Group>
      <Row>
        <SelectField
          prop="flex-direction"
          label="Direction"
          options={DIRECTIONS}
        />
        <SelectField prop="flex-wrap" label="Wrap" options={WRAPS} />
      </Row>
      <Row>
        <SelectField prop="justify-content" label="Justify" options={JUSTIFY} />
        <SelectField prop="align-items" label="Align items" options={ALIGN} />
      </Row>
      <Row>
        <SelectField
          prop="align-self"
          label="Align self"
          options={ALIGN_SELF}
        />
        <LengthField prop="order" label="Order" unitless />
      </Row>
      <Row>
        <LengthField prop="flex-grow" label="Grow" unitless />
        <LengthField prop="flex-shrink" label="Shrink" unitless />
      </Row>
      <LengthField prop="flex-basis" label="Basis" />
      <TextStyleField prop="grid-template-columns" label="Grid columns" />
      <TextStyleField prop="grid-template-rows" label="Grid rows" />
    </Group>
  )
}

export function AppearanceGroup() {
  return (
    <Group>
      <ColorField prop="background-color" label="Background" />
      <OpacityField />
      <Row>
        <LengthField prop="border-radius" label="Radius" />
        <LengthField prop="border-width" label="Border width" />
      </Row>
      <Row>
        <SelectField
          prop="border-style"
          label="Border style"
          options={BORDER_STYLES}
        />
        <ColorField prop="border-color" label="Border colour" />
      </Row>
      <TextStyleField prop="box-shadow" label="Shadow" />
      <TextStyleField prop="background-image" label="Background image" />
      <TextStyleField prop="transform" label="Transform" />
      <TextStyleField prop="filter" label="Filter" />
      <TextStyleField prop="transition" label="Transition" />
      <Row>
        <SelectField prop="cursor" label="Cursor" options={CURSORS} />
        <SelectField
          prop="pointer-events"
          label="Pointer events"
          options={POINTER_EVENTS}
        />
      </Row>
    </Group>
  )
}

// shortcut: splits on ";" so a ";" inside a value (data: URI) breaks it; use the fields above for those.
const DECLARATION = /^\s*([a-z-][\w-]*)\s*:\s*([^]*?)\s*$/i

/** Any property DevTools accepts: `prop: value;` lines, applied one by one. `prop:` with no value removes it. */
export function CustomCssGroup() {
  const { set } = useEdit()
  const [text, setText] = useState("")
  const apply = () => {
    for (const part of text.split(";")) {
      const m = DECLARATION.exec(part)
      if (m) set(m[1].toLowerCase(), m[2])
    }
    setText("")
  }
  return (
    <Group>
      <Field>
        <FieldLabel
          htmlFor="redline-custom-css"
          className="text-xs font-normal text-muted-foreground"
        >
          Declarations, like the DevTools Styles pane
        </FieldLabel>
        <Textarea
          id="redline-custom-css"
          rows={3}
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) apply()
          }}
          placeholder={"mix-blend-mode: multiply;\noutline: 2px solid red;"}
          className="min-h-16 font-mono text-xs md:text-xs"
        />
      </Field>
      <Button
        variant="outline"
        size="sm"
        disabled={!text.trim()}
        onClick={apply}
      >
        Apply
      </Button>
    </Group>
  )
}
