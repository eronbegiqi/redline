import { describe, expect, it } from "vitest"

import {
  canonColor,
  emitColor,
  formatColor,
  formatNumber,
  normalizeLength,
  parseColor,
  pickerHex,
  sameValue,
  stepValue,
  toHex,
} from "./css"

describe("parseColor", () => {
  it("parses computed rgb()/rgba()", () => {
    expect(parseColor("rgb(59, 130, 246)")).toEqual({
      r: 59,
      g: 130,
      b: 246,
      a: 1,
    })
    expect(parseColor("rgba(0, 0, 0, 0.5)")).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0.5,
    })
    expect(parseColor("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it("parses modern space syntax, percentages and typed hex", () => {
    expect(parseColor("rgb(59 130 246 / 50%)")).toEqual({
      r: 59,
      g: 130,
      b: 246,
      a: 0.5,
    })
    expect(parseColor("rgb(100%, 0%, 0%)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    })
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor("#F008")?.a).toBeCloseTo(0x88 / 255)
    expect(parseColor("#3b82f680")).toMatchObject({ r: 59, g: 130, b: 246 })
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it("clamps out-of-range channels", () => {
    expect(parseColor("rgb(300, -5, 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 })
  })

  it("returns null for named / unsupported / malformed values", () => {
    for (const v of [
      "red",
      "hsl(0 100% 50%)",
      "oklch(0.7 0.1 200)",
      "color(srgb 1 0 0)",
      "var(--brand)",
      "currentcolor",
      "",
      "#12",
      "#12345",
      "rgb(1, 2)",
      "rgb(a, b, c)",
      "rgb(0, 0, 0) rgb(1, 1, 1) rgb(2, 2, 2) rgb(3, 3, 3)",
    ]) {
      expect(parseColor(v), v).toBeNull()
    }
  })
})

describe("toHex / canonColor / formatColor / pickerHex", () => {
  it("emits #rrggbb when opaque and #rrggbbaa otherwise", () => {
    expect(toHex({ r: 59, g: 130, b: 246, a: 1 })).toBe("#3b82f6")
    expect(toHex({ r: 0, g: 0, b: 0, a: 0.5 })).toBe("#00000080")
    expect(toHex({ r: 255, g: 0, b: 0, a: 0 })).toBe("#ff000000")
    // 0.999 rounds to a full alpha byte, so no suffix.
    expect(toHex({ r: 1, g: 2, b: 3, a: 0.999 })).toBe("#010203")
  })

  it("canonicalises equivalent spellings to the same string", () => {
    const same = [
      "rgb(59, 130, 246)",
      "#3B82F6",
      "#3b82f6ff",
      "rgb(59 130 246 / 100%)",
    ]
    expect(new Set(same.map(canonColor))).toEqual(new Set(["#3b82f6"]))
    expect(canonColor("transparent")).toBe("#00000000")
    expect(canonColor("rgba(0, 0, 0, 0)")).toBe("#00000000")
  })

  it("compares unsupported values lower-cased, but emits them as typed", () => {
    expect(canonColor("  RED ")).toBe("red")
    expect(canonColor("oklch(0.7 0.1 200)")).toBe("oklch(0.7 0.1 200)")
    expect(emitColor("  var(--Brand) ")).toBe("var(--Brand)")
    expect(emitColor("rgb(59, 130, 246)")).toBe("#3b82f6")
    expect(emitColor("rgba(0, 0, 0, 0.5)")).toBe("#00000080")
  })

  it("shows `transparent` only for the default transparent black", () => {
    expect(formatColor("rgba(0, 0, 0, 0)")).toBe("transparent")
    expect(formatColor("rgba(255, 0, 0, 0)")).toBe("#ff000000")
    expect(formatColor("rgb(59, 130, 246)")).toBe("#3b82f6")
    expect(formatColor(" red ")).toBe("red")
  })

  it("falls back to black for the picker when the value can't be parsed", () => {
    expect(pickerHex("rgb(59, 130, 246)")).toBe("#3b82f6")
    expect(pickerHex("rgba(0, 0, 0, 0)")).toBe("#00000000")
    expect(pickerHex("red")).toBe("#000000")
    expect(pickerHex("")).toBe("#000000")
  })
})

describe("sameValue", () => {
  it("ignores case and whitespace", () => {
    expect(sameValue(" 16PX ", "16px")).toBe(true)
    expect(sameValue("10px  20px", "10px 20px")).toBe(true)
    expect(sameValue("16px", "17px")).toBe(false)
  })
})

describe("normalizeLength", () => {
  it("maps `full` to 100%", () => {
    expect(normalizeLength(" Full ")).toBe("100%")
  })

  it("appends px to a bare number", () => {
    expect(normalizeLength("16")).toBe("16px")
    expect(normalizeLength(" -4.5 ")).toBe("-4.5px")
    expect(normalizeLength(".5")).toBe(".5px")
    expect(normalizeLength("0")).toBe("0px")
  })

  it("leaves units, keywords and functions alone", () => {
    for (const v of [
      "1rem",
      "50%",
      "auto",
      "calc(100% - 8px)",
      "10px 20px",
      "normal",
      "",
    ]) {
      expect(normalizeLength(v), v).toBe(v)
    }
  })

  it("keeps bare numbers for unitless properties (line-height)", () => {
    expect(normalizeLength("1.5", true)).toBe("1.5")
  })
})

describe("stepValue", () => {
  it("steps px by 1, shift x10, alt x0.1", () => {
    expect(stepValue("16px", 1)).toBe("17px")
    expect(stepValue("16px", -1)).toBe("15px")
    expect(stepValue("16px", 1, { shift: true })).toBe("26px")
    expect(stepValue("16px", -1, { shift: true })).toBe("6px")
    expect(stepValue("16px", 1, { alt: true })).toBe("16.1px")
  })

  it("steps em/rem/unitless by 0.1 without float noise", () => {
    expect(stepValue("1.2em", 1)).toBe("1.3em")
    expect(stepValue("0.1rem", 1)).toBe("0.2rem")
    expect(stepValue("1.5", 1)).toBe("1.6")
    expect(stepValue("0.3", -1)).toBe("0.2")
    expect(stepValue("1", 1, { shift: true })).toBe("2")
  })

  it("honours an explicit step", () => {
    expect(stepValue("0.5px", 1, { step: 0.1 })).toBe("0.6px")
    expect(stepValue("10px", 1, { step: 4 })).toBe("14px")
  })

  it("goes negative, handles %, and never prints -0", () => {
    expect(stepValue("0px", -1)).toBe("-1px")
    expect(stepValue("50%", 1)).toBe("51%")
    expect(stepValue("-0.1px", 1, { alt: true })).toBe("0px")
  })

  it("returns null for values it can't step", () => {
    for (const v of [
      "auto",
      "normal",
      "10px 20px",
      "calc(1px + 2px)",
      "",
      "red",
      "px",
    ]) {
      expect(stepValue(v, 1), v).toBeNull()
    }
  })

  it("can start from the `normal` keyword when asked", () => {
    expect(stepValue("normal", 1, { zero: true })).toBe("1px")
    expect(stepValue("normal", -1, { zero: true, step: 0.5 })).toBe("-0.5px")
  })
})

describe("formatNumber", () => {
  it("rounds to two decimals and drops trailing zeros", () => {
    expect(formatNumber(0.5)).toBe("0.5")
    expect(formatNumber(1)).toBe("1")
    expect(formatNumber(0.3333)).toBe("0.33")
    expect(formatNumber(0)).toBe("0")
  })
})
