import { FieldGroup } from "@/components/ui/field"
import type { ReactNode } from "react"

import {
  AlignField,
  ColorField,
  LengthField,
  OpacityField,
  SelectField,
  SidesField,
  type Option,
} from "./fields"

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
    </Group>
  )
}

export function SpacingGroup() {
  return (
    <Group>
      <SidesField kind="padding" label="Padding" />
      <SidesField kind="margin" label="Margin" />
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
        <SelectField prop="display" label="Display" options={DISPLAYS} />
        <LengthField prop="gap" label="Gap" zero />
      </Row>
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
    </Group>
  )
}
