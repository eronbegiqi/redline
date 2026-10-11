import type { ElementComment } from "@/shared/types"

// Comments outlive a page reload: stored per page (origin + path) in the panel's own localStorage.
// Element ids do not survive a reload, so a restored comment has a placeholder `el` until its element is selected again.

const PREFIX = "saved:"
export const placeholderEl = (selector: string) => `${PREFIX}${selector}`
export const isPlaceholder = (el: string) => el.startsWith(PREFIX)

const key = (pageUrl: string) => {
  try {
    const u = new URL(pageUrl)
    return `redline:comments:${u.origin}${u.pathname}`
  } catch {
    return `redline:comments:${pageUrl}`
  }
}

export function loadComments(pageUrl: string): ElementComment[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(pageUrl)) ?? "[]")
    return (Array.isArray(raw) ? raw : [])
      .filter(
        (c) =>
          typeof c?.text === "string" && typeof c?.target?.selector === "string"
      )
      .map((c) => ({
        el: placeholderEl(c.target.selector),
        target: c.target,
        text: c.text,
      }))
  } catch {
    return []
  }
}

export function saveComments(pageUrl: string, list: ElementComment[]) {
  try {
    if (list.length) localStorage.setItem(key(pageUrl), JSON.stringify(list))
    else localStorage.removeItem(key(pageUrl))
  } catch {
    // storage blocked: comments just last for this session
  }
}
