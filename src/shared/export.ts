import type { Change, PageInfo } from "./types"

// STUB - owned by the "shared core" agent. Pure + deterministic (no Date.now inside).
export interface ExportMeta {
  page: PageInfo
  /** ISO date string supplied by the caller. */
  capturedAt: string
  /** Free-text instructions the user typed for the AI. May be empty. */
  note?: string
}

/** Markdown prompt for an AI coding assistant. See docs/SPEC.md "Export format". */
export function buildExport(_changes: Change[], _meta: ExportMeta): string {
  throw new Error("not implemented")
}
