import { beforeEach, describe, expect, it } from "vitest"
import { settleStyleAttr } from "@/content/guard"

const el = (html: string) => {
  document.body.innerHTML = html
  return document.body.firstElementChild as HTMLElement
}

describe("settleStyleAttr", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("drops the attribute when there was none and no declaration is left", () => {
    const p = el("<p>x</p>")
    p.style.color = "red"
    p.style.removeProperty("color")
    settleStyleAttr(p, null)
    expect(p.hasAttribute("style")).toBe(false)
  })

  it("keeps it while declarations remain", () => {
    const p = el("<p>x</p>")
    p.style.color = "red"
    settleStyleAttr(p, null)
    expect(p.getAttribute("style")).toBe("color: red;")
  })

  it("puts the authored text back once the declarations equal the original again", () => {
    const p = el('<p style="color:red;margin:0">x</p>')
    p.style.width = "1px"
    settleStyleAttr(p, "color:red;margin:0")
    expect(p.getAttribute("style")).toContain("width") // not the original yet
    p.style.removeProperty("width")
    settleStyleAttr(p, "color:red;margin:0")
    expect(p.getAttribute("style")).toBe("color:red;margin:0")
  })

  it("keeps an authored empty style attribute", () => {
    const p = el('<p style="">x</p>')
    p.style.width = "1px"
    p.style.removeProperty("width")
    settleStyleAttr(p, "")
    expect(p.outerHTML).toBe('<p style="">x</p>')
  })

  it("reads the attribute before removing it (forces Chrome's lazy CSSOM -> attribute sync)", () => {
    const p = el("<p>x</p>")
    const calls: string[] = []
    const get = p.getAttribute.bind(p)
    const rm = p.removeAttribute.bind(p)
    p.getAttribute = (n: string) => (n === "style" && calls.push("get"), get(n))
    p.removeAttribute = (n: string) => (n === "style" && calls.push("remove"), rm(n))
    settleStyleAttr(p, null)
    expect(calls).toEqual(["get", "remove"])
  })

  it("never throws on elements without a style object", () => {
    expect(() => settleStyleAttr(document.createElementNS("http://www.w3.org/1999/xhtml", "x-y"), null)).not.toThrow()
  })
})
