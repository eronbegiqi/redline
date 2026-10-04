import { describe, expect, it } from "vitest"
import { buildExport, type ExportMeta } from "./export"
import type { Change, ChangeBody, Descriptor, SourceHint } from "./types"

const d = (selector: string, extra: Partial<Descriptor> = {}): Descriptor => ({
  selector,
  tag: "div",
  classes: [],
  ...extra,
})

let seq = 0
const ch = (
  el: string,
  target: Descriptor,
  body: ChangeBody,
  origin: Change["origin"] = "panel"
): Change => ({ id: `c${++seq}`, el, target, origin, at: 0, ...body }) as Change

const meta: ExportMeta = {
  page: {
    url: "http://localhost:5173/",
    title: "Home",
    viewport: { width: 1280, height: 720 },
  },
  capturedAt: "2026-10-04T12:00:00.000Z",
}

const PAGE_LINES = [
  "# Redline: UI changes to apply",
  "",
  "**Page:** Home - http://localhost:5173/",
  "**Viewport:** 1280×720 · **Captured:** 2026-10-04T12:00:00.000Z",
  "",
]
const PREAMBLE =
  "Apply the changes below to this page's source code. Find each element using its component/source hint, selector or text. " +
  "Values are computed CSS from the live page: translate them into the project's own styling approach " +
  "(Tailwind classes, CSS modules, styled-components, …) instead of adding inline styles, and keep the result responsive. " +
  "Change only what is listed. Indexes are 0-based among the parent's element children."

/** Lines -> document (every document ends with exactly one newline). */
const doc = (...lines: string[]) => lines.join("\n") + "\n"

/** The bullet lines of the single `###` block produced for one change. */
function bulletOf(change: Change): string {
  const out = buildExport([change], meta)
  const lines = out.split("\n").filter((l) => l.startsWith("- "))
  expect(lines).toHaveLength(1)
  return lines[0]
}

const cta = d("main > button:nth-of-type(1)", {
  tag: "button",
  id: "cta",
  classes: ["btn", "btn-primary"],
  text: "Get started",
  attrs: { "data-testid": "cta" },
  source: {
    framework: "react",
    component: "CtaButton",
    chain: ["CtaButton", "Hero"],
    file: "src/Hero.tsx",
    line: 42,
    column: 7,
  },
})

describe("buildExport: representative log", () => {
  const changes: Change[] = [
    ch("e1", cta, {
      kind: "style",
      prop: "background-color",
      before: "rgb(0, 0, 0)",
      after: "rgb(59, 130, 246)",
    }),
    ch("e1", cta, {
      kind: "text",
      textNode: 0,
      before: "Get started",
      after: "Start free",
    }),
    ch("e1", cta, { kind: "class", added: ["is-active"], removed: ["muted"] }),
    ch(
      "e1",
      cta,
      { kind: "attr", name: "href", before: "/a", after: "/b" },
      "devtools"
    ),
    ch("e2", d("ul.list > li:nth-of-type(4)", { tag: "li" }), {
      kind: "move",
      from: { parent: d("ul.list"), index: 3 },
      to: { parent: d("ul.list"), index: 1, before: d("li.first") },
    }),
    ch("e3", d("footer > p", { tag: "p", text: "Old footer" }), {
      kind: "delete",
    }),
    ch(
      "e4",
      d("ul.list > li:nth-of-type(5)", { tag: "li", classes: ["item"] }),
      {
        kind: "insert",
        placement: { parent: d("ul.list"), index: 4 },
        html: '<li class="item">…</li>',
        duplicateOf: d("li.item"),
      }
    ),
  ]

  it("matches the exact document, with notes", () => {
    expect(
      buildExport(changes, { ...meta, note: "Keep the button accessible." })
    ).toBe(
      doc(
        ...PAGE_LINES,
        PREAMBLE,
        "",
        "## Notes",
        "Keep the button accessible.",
        "",
        "## Changes",
        '### 1. `main > button:nth-of-type(1)` "Get started" - React: Hero › CtaButton · src/Hero.tsx:42',
        'Element: `<button id="cta" class="btn btn-primary" data-testid="cta">`',
        "- **Style** `background-color`: `rgb(0, 0, 0)` → `rgb(59, 130, 246)`",
        '- **Text**: "Get started" → "Start free"',
        "- **Class**: added `is-active`, removed `muted`",
        "- **Attribute** `href`: `/a` → `/b` _(DevTools)_",
        "",
        "### 2. `ul.list > li:nth-of-type(4)`",
        "- **Move**: from index 3 in `ul.list` → index 1 in `ul.list` (before `li.first`)",
        "",
        '### 3. `footer > p` "Old footer"',
        "- **Delete**: remove this element",
        "",
        "### 4. `ul.list > li:nth-of-type(5)`",
        'Element: `<li class="item">`',
        '- **Insert** (copy of `li.item`) at index 4 in `ul.list`: `<li class="item">…</li>`'
      )
    )
  })

  it("omits the Notes section when there is no note (undefined, empty or whitespace)", () => {
    const without = buildExport(changes, meta)
    expect(without).not.toContain("## Notes")
    expect(buildExport(changes, { ...meta, note: "" })).toBe(without)
    expect(buildExport(changes, { ...meta, note: "  \n\t " })).toBe(without)
  })

  it("trims the note but keeps its inner lines", () => {
    const out = buildExport(changes, {
      ...meta,
      note: "\n  First line\nSecond line  \n",
    })
    expect(out).toContain("## Notes\nFirst line\nSecond line\n\n## Changes\n")
  })

  it("is deterministic and does not mutate its input", () => {
    const frozen = structuredClone(changes)
    const a = buildExport(changes, { ...meta, note: "n" })
    const b = buildExport(structuredClone(changes), { ...meta, note: "n" })
    expect(a).toBe(b)
    expect(changes).toEqual(frozen)
  })

  it("ends with exactly one newline and never prints undefined/[object", () => {
    const out = buildExport(changes, meta)
    expect(out.endsWith("\n")).toBe(true)
    expect(out.endsWith("\n\n")).toBe(false)
    expect(out).not.toMatch(/undefined|\[object|null/)
  })
})

describe("buildExport: empty log", () => {
  it("is a short document", () => {
    expect(buildExport([], meta)).toBe(
      doc(...PAGE_LINES, "No changes recorded.")
    )
  })

  it("still shows a note the user typed", () => {
    expect(buildExport([], { ...meta, note: "hello" })).toBe(
      doc(...PAGE_LINES, "## Notes", "hello", "", "No changes recorded.")
    )
  })
})

describe("buildExport: page header", () => {
  it("drops the title part when the page has none and collapses whitespace in the title", () => {
    const untitled = buildExport([], {
      ...meta,
      page: { ...meta.page, title: "" },
    })
    expect(untitled).toContain("**Page:** http://localhost:5173/\n")
    const messy = buildExport([], {
      ...meta,
      page: { ...meta.page, title: "  My \n  shop \t" },
    })
    expect(messy).toContain("**Page:** My shop - http://localhost:5173/\n")
  })
})

describe("buildExport: grouping and numbering", () => {
  const a = d("#a", { text: "first-touch A" })
  const b = d("#b")
  const c = d("#c")
  const log: Change[] = [
    ch("e2", b, { kind: "attr", name: "title", before: null, after: "b1" }),
    ch("e1", a, { kind: "attr", name: "title", before: null, after: "a1" }),
    ch("e2", d("#b-later-descriptor"), {
      kind: "attr",
      name: "alt",
      before: null,
      after: "b2",
    }),
    ch("e3", c, { kind: "delete" }),
    ch("e1", d("#a-later-descriptor"), {
      kind: "attr",
      name: "alt",
      before: null,
      after: "a2",
    }),
  ]

  it("one block per element, numbered by first appearance, bullets in log order, heading from the first change", () => {
    const body = buildExport(log, meta).split("## Changes\n")[1]
    expect(body).toBe(
      [
        "### 1. `#b`",
        "- **Attribute** `title`: (not set) → `b1`",
        "- **Attribute** `alt`: (not set) → `b2`",
        "",
        '### 2. `#a` "first-touch A"',
        "- **Attribute** `title`: (not set) → `a1`",
        "- **Attribute** `alt`: (not set) → `a2`",
        "",
        "### 3. `#c`",
        "- **Delete**: remove this element",
        "",
      ].join("\n")
    )
  })

  it("is not affected by id strings of the changes themselves", () => {
    const shuffled = log.map((x, i) => ({ ...x, id: `z${log.length - i}` }))
    expect(buildExport(shuffled, meta)).toBe(buildExport(log, meta))
  })
})

describe("buildExport: element header", () => {
  const heading = (t: Descriptor) =>
    buildExport([ch("e1", t, { kind: "delete" })], meta)
      .split("\n")
      .find((l) => l.startsWith("### "))

  it("has no source suffix and no text when neither exists", () => {
    expect(heading(d("#x"))).toBe("### 1. `#x`")
  })

  it.each<[string, SourceHint, string]>([
    [
      "react chain, outermost first",
      {
        framework: "react",
        component: "CtaButton",
        chain: ["CtaButton", "Hero", "App"],
        file: "src/Hero.tsx",
        line: 42,
      },
      "React: App › Hero › CtaButton · src/Hero.tsx:42",
    ],
    ["component only", { framework: "vue", component: "Card" }, "Vue: Card"],
    [
      "file only",
      { framework: "svelte", file: "src/Card.svelte" },
      "Svelte: src/Card.svelte",
    ],
    [
      "file and line, no column",
      { framework: "react", file: "a.tsx", line: 3, column: 9 },
      "React: a.tsx:3",
    ],
    [
      "line without a file is dropped",
      { framework: "react", component: "X", line: 3 },
      "React: X",
    ],
    ["framework only", { framework: "vue" }, "Vue"],
    [
      "empty chain falls back to component",
      { framework: "react", component: "Solo", chain: [] },
      "React: Solo",
    ],
  ])("source hint: %s", (_name, source, expected) => {
    expect(heading(d("#x", { source }))).toBe(`### 1. \`#x\` - ${expected}`)
  })

  it("shows text, then source", () => {
    expect(
      heading(
        d("#x", { text: "Hi", source: { framework: "vue", component: "A" } })
      )
    ).toBe('### 1. `#x` "Hi" - Vue: A')
  })

  it("quotes text safely and caps it at 80 characters", () => {
    expect(heading(d("#x", { text: 'say "hi"\nnow' }))).toBe(
      '### 1. `#x` "say \\"hi\\"\\nnow"'
    )
    expect(heading(d("#x", { text: "x".repeat(81) }))).toBe(
      `### 1. \`#x\` "${"x".repeat(80)}…"`
    )
    expect(heading(d("#x", { text: "x".repeat(80) }))).toBe(
      `### 1. \`#x\` "${"x".repeat(80)}"`
    )
  })

  it("survives a descriptor whose optional parts are missing", () => {
    const bare = { selector: "#x", tag: "div" } as Descriptor // classes missing on the wire
    expect(() =>
      buildExport([ch("e1", bare, { kind: "delete" })], meta)
    ).not.toThrow()
  })
})

describe("buildExport: Element line (original opening tag)", () => {
  const lines = (t: Descriptor) =>
    buildExport([ch("e1", t, { kind: "delete" })], meta)
      .split("\n")
      .filter((l) => l.startsWith("Element:"))

  it("is skipped when there are no classes or attributes (it would only repeat the selector)", () => {
    expect(lines(d("#x", { id: "x", tag: "section" }))).toEqual([])
  })

  it("lists id, classes and whitelisted attributes in that order", () => {
    expect(
      lines(
        d("#x", {
          tag: "a",
          id: "x",
          classes: ["p-4", "text-sm"],
          attrs: { href: "/pricing", "aria-label": "Pricing" },
        })
      )
    ).toEqual([
      'Element: `<a id="x" class="p-4 text-sm" href="/pricing" aria-label="Pricing">`',
    ])
  })

  it("works with attributes only", () => {
    expect(
      lines(
        d("#x", {
          tag: "input",
          attrs: { type: "email", placeholder: "you@example.com" },
        })
      )
    ).toEqual(['Element: `<input type="email" placeholder="you@example.com">`'])
  })

  it("escapes double quotes, collapses whitespace, handles backticks", () => {
    expect(
      lines(d("#x", { tag: "img", attrs: { alt: 'a "b"\n  c`d' } }))
    ).toEqual(['Element: ``<img alt="a &quot;b&quot; c`d">``'])
  })
})

describe("buildExport: bullets", () => {
  const t = d("#x")

  it("style", () => {
    expect(
      bulletOf(
        ch("e1", t, {
          kind: "style",
          prop: "font-size",
          before: "16px",
          after: "20px",
        })
      )
    ).toBe("- **Style** `font-size`: `16px` → `20px`")
  })

  it("text, quoted JSON-style so quotes and newlines cannot break the line", () => {
    expect(
      bulletOf(
        ch("e1", t, {
          kind: "text",
          textNode: 0,
          before: 'He said "hi"',
          after: "Line 1\nLine 2",
        })
      )
    ).toBe('- **Text**: "He said \\"hi\\"" → "Line 1\\nLine 2"')
  })

  it("text: says which child node when it is not the first", () => {
    expect(
      bulletOf(
        ch("e1", t, {
          kind: "text",
          textNode: 2,
          before: " world",
          after: " there",
        })
      )
    ).toBe('- **Text** (child node 2): " world" → " there"')
  })

  it("text: empty strings stay visible", () => {
    expect(
      bulletOf(
        ch("e1", t, { kind: "text", textNode: 0, before: "", after: "New" })
      )
    ).toBe('- **Text**: "" → "New"')
  })

  it.each<[string, string[], string[], string]>([
    ["added only", ["a"], [], "- **Class**: added `a`"],
    ["removed only", [], ["b"], "- **Class**: removed `b`"],
    ["both", ["a"], ["b"], "- **Class**: added `a`, removed `b`"],
    [
      "several of each",
      ["a", "b"],
      ["c", "d"],
      "- **Class**: added `a` `b`, removed `c` `d`",
    ],
    ["nothing (should not happen)", [], [], "- **Class**: (no net change)"],
  ])("class: %s", (_name, added, removed, expected) => {
    expect(bulletOf(ch("e1", t, { kind: "class", added, removed }))).toBe(
      expected
    )
  })

  it("attribute", () => {
    expect(
      bulletOf(
        ch("e1", t, { kind: "attr", name: "href", before: "/a", after: "/b" })
      )
    ).toBe("- **Attribute** `href`: `/a` → `/b`")
  })

  it("move across parents, with orientation on both ends", () => {
    expect(
      bulletOf(
        ch("e1", t, {
          kind: "move",
          from: { parent: d("ul.a"), index: 3, before: d("li.next") },
          to: { parent: d("ol.b"), index: 0, before: d("li.first") },
        })
      )
    ).toBe(
      "- **Move**: from index 3 in `ul.a` (before `li.next`) → index 0 in `ol.b` (before `li.first`)"
    )
  })

  it("move without `before` is just index + parent", () => {
    expect(
      bulletOf(
        ch("e1", t, {
          kind: "move",
          from: { parent: d("ul"), index: 0 },
          to: { parent: d("ul"), index: 5 },
        })
      )
    ).toBe("- **Move**: from index 0 in `ul` → index 5 in `ul`")
  })

  it("delete", () => {
    expect(bulletOf(ch("e1", t, { kind: "delete" }))).toBe(
      "- **Delete**: remove this element"
    )
  })

  it("insert that is not a duplicate, with orientation", () => {
    expect(
      bulletOf(
        ch("e1", t, {
          kind: "insert",
          placement: { parent: d("main"), index: 2, before: d("footer") },
          html: "<p>New</p>",
        })
      )
    ).toBe("- **Insert** at index 2 in `main` (before `footer`): `<p>New</p>`")
  })

  it("insert that is a duplicate", () => {
    expect(
      bulletOf(
        ch("e1", t, {
          kind: "insert",
          placement: { parent: d("ul.list"), index: 4 },
          html: "<li>x</li>",
          duplicateOf: d("li.item"),
        })
      )
    ).toBe(
      "- **Insert** (copy of `li.item`) at index 4 in `ul.list`: `<li>x</li>`"
    )
  })

  it.each<[string, ChangeBody]>([
    ["style", { kind: "style", prop: "color", before: "a", after: "b" }],
    ["text", { kind: "text", textNode: 0, before: "a", after: "b" }],
    ["attr", { kind: "attr", name: "title", before: "a", after: "b" }],
    ["class", { kind: "class", added: ["a"], removed: [] }],
    [
      "move",
      {
        kind: "move",
        from: { parent: d("ul"), index: 0 },
        to: { parent: d("ul"), index: 1 },
      },
    ],
    ["delete", { kind: "delete" }],
    [
      "insert",
      {
        kind: "insert",
        placement: { parent: d("ul"), index: 0 },
        html: "<li></li>",
      },
    ],
  ])("devtools origin tags the %s bullet", (_name, body) => {
    expect(bulletOf(ch("e1", t, body, "devtools"))).toMatch(/ _\(DevTools\)_$/)
    expect(bulletOf(ch("e1", t, body, "panel"))).not.toContain("DevTools")
  })

  it("does not throw on a change kind it does not know", () => {
    const odd = {
      id: "c1",
      el: "e1",
      target: t,
      origin: "panel",
      at: 0,
      kind: "from-the-future",
    } as unknown as Change
    expect(() => buildExport([odd], meta)).not.toThrow()
  })
})

describe("buildExport: missing before / after", () => {
  const t = d("#x")
  it.each<[string, ChangeBody, string]>([
    [
      "style before null",
      { kind: "style", prop: "color", before: null, after: "red" },
      "- **Style** `color`: (unset inline / from stylesheet) → `red`",
    ],
    [
      "style after null",
      { kind: "style", prop: "color", before: "red", after: null },
      "- **Style** `color`: `red` → (removed)",
    ],
    [
      "style both null",
      { kind: "style", prop: "color", before: null, after: null },
      "- **Style** `color`: (unset inline / from stylesheet) → (removed)",
    ],
    [
      "attr before null (attribute was absent)",
      { kind: "attr", name: "title", before: null, after: "x" },
      "- **Attribute** `title`: (not set) → `x`",
    ],
    [
      "attr after null",
      { kind: "attr", name: "title", before: "x", after: null },
      "- **Attribute** `title`: `x` → (removed)",
    ],
    [
      "style empty string",
      { kind: "style", prop: "content", before: "", after: "x" },
      "- **Style** `content`: (empty) → `x`",
    ],
    [
      "attr empty string (boolean attribute)",
      { kind: "attr", name: "disabled", before: null, after: "" },
      "- **Attribute** `disabled`: (not set) → (empty)",
    ],
  ])("%s", (_name, body, expected) => {
    expect(bulletOf(ch("e1", t, body))).toBe(expected)
  })

  it("treats undefined (lost in a JSON round trip) like null", () => {
    const body = {
      kind: "style",
      prop: "color",
      after: "red",
    } as unknown as ChangeBody
    expect(bulletOf(ch("e1", t, body))).toBe(
      "- **Style** `color`: (unset inline / from stylesheet) → `red`"
    )
  })
})

describe("buildExport: backticks", () => {
  const t = d("#x")
  it.each<[string, string, string]>([
    ["inside", "a`b", "``a`b``"],
    ["a run of two", "a``b", "```a``b```"],
    ["at the start", "`a", "`` `a ``"],
    ["at the end", "a`", "`` a` ``"],
    ["only a backtick", "`", "`` ` ``"],
    ["none", "plain", "`plain`"],
  ])("style value with backticks %s", (_name, v, rendered) => {
    expect(
      bulletOf(
        ch("e1", t, { kind: "style", prop: "content", before: "x", after: v })
      )
    ).toBe(`- **Style** \`content\`: \`x\` → ${rendered}`)
  })

  it("also protects selectors, property/attribute names, class names, hints and html", () => {
    const target = d("[data-x='a`b']", {
      text: "t`x",
      source: { framework: "react", component: "A" },
    })
    const out = buildExport(
      [
        ch("e1", target, {
          kind: "attr",
          name: "a`b",
          before: "1",
          after: "2",
        }),
        ch("e1", target, { kind: "class", added: ["c`d"], removed: [] }),
        ch("e1", target, {
          kind: "insert",
          placement: { parent: d("ul`x"), index: 0 },
          html: "<b>`</b>",
          duplicateOf: d("li`y"),
        }),
      ],
      meta
    )
    expect(out).toContain("### 1. ``[data-x='a`b']`` \"t`x\" - React: A")
    expect(out).toContain("- **Attribute** ``a`b``: `1` → `2`")
    expect(out).toContain("- **Class**: added ``c`d``")
    expect(out).toContain(
      "- **Insert** (copy of ``li`y``) at index 0 in ``ul`x``: ``<b>`</b>``"
    )
  })

  it("leaves backticks in double-quoted text alone", () => {
    expect(
      bulletOf(
        ch("e1", t, {
          kind: "text",
          textNode: 0,
          before: "use `npm`",
          after: "use `pnpm`",
        })
      )
    ).toBe('- **Text**: "use `npm`" → "use `pnpm`"')
  })
})

describe("buildExport: truncation and one-line values", () => {
  const t = d("#x")

  it("text: 120 characters fit, 121 are cut to 120 plus an ellipsis, inside the quotes", () => {
    const fits = bulletOf(
      ch("e1", t, {
        kind: "text",
        textNode: 0,
        before: "a".repeat(120),
        after: "b",
      })
    )
    expect(fits).toBe(`- **Text**: "${"a".repeat(120)}" → "b"`)
    const cut = bulletOf(
      ch("e1", t, {
        kind: "text",
        textNode: 0,
        before: "a".repeat(121),
        after: "b".repeat(300),
      })
    )
    expect(cut).toBe(
      `- **Text**: "${"a".repeat(120)}…" → "${"b".repeat(120)}…"`
    )
  })

  it("html: 400 characters fit, more are cut to 400 plus an ellipsis", () => {
    const insert = (html: string) =>
      bulletOf(
        ch("e1", t, {
          kind: "insert",
          placement: { parent: d("ul"), index: 0 },
          html,
        })
      )
    const fits = "<p>" + "x".repeat(397)
    expect(fits).toHaveLength(400)
    expect(insert(fits)).toBe(`- **Insert** at index 0 in \`ul\`: \`${fits}\``)
    expect(insert(fits + "y")).toBe(
      `- **Insert** at index 0 in \`ul\`: \`${fits}…\``
    )
  })

  it("never cuts a surrogate pair in half", () => {
    const text = "a".repeat(119) + "😀" + "tail"
    expect(
      bulletOf(
        ch("e1", t, { kind: "text", textNode: 0, before: text, after: "b" })
      )
    ).toBe(`- **Text**: "${"a".repeat(119)}…" → "b"`)
  })

  it("style/attr values are capped (200) so a data: URI cannot flood the prompt", () => {
    const url = "url(data:image/png;base64," + "A".repeat(5000) + ")"
    const out = bulletOf(
      ch("e1", t, {
        kind: "style",
        prop: "background-image",
        before: null,
        after: url,
      })
    )
    expect(out).toBe(
      `- **Style** \`background-image\`: (unset inline / from stylesheet) → \`${url.slice(0, 200)}…\``
    )
    expect(out.length).toBeLessThan(300)
  })

  it("keeps every bullet on one line: whitespace runs and newlines collapse in code values", () => {
    const style = bulletOf(
      ch("e1", t, {
        kind: "style",
        prop: "font-family",
        before: "a,\n   b",
        after: "c,\t\td",
      })
    )
    expect(style).toBe("- **Style** `font-family`: `a, b` → `c, d`")
    const html = bulletOf(
      ch("e1", t, {
        kind: "insert",
        placement: { parent: d("ul"), index: 0 },
        html: "<ul>\n  <li>a</li>\n</ul>",
      })
    )
    expect(html).toBe(
      "- **Insert** at index 0 in `ul`: `<ul> <li>a</li> </ul>`"
    )
  })
})
