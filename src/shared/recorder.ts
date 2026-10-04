import type { Change, NewChange } from "./types"

// STUB - signatures are the contract; implementation owned by the "shared core" agent.
// Pure TS: no DOM, no chrome.*. See docs/SPEC.md "Recorder rules".
export class Recorder {
  /** Add a change, merging/cancelling per the rules in SPEC. Returns the resulting log entry, or null if it cancelled out / was a no-op. */
  record(_nc: NewChange): Change | null {
    throw new Error("not implemented")
  }
  /** Wire copy of the log (no closures), oldest first. */
  list(): Change[] {
    throw new Error("not implemented")
  }
  /** Run the entry's reverts (newest first) then drop it. No-op for unknown ids. */
  revert(_id: string): void {
    throw new Error("not implemented")
  }
  /** Revert the most recent entry. */
  undo(): void {
    throw new Error("not implemented")
  }
  /** Revert every entry (newest first) and clear the log. */
  revertAll(): void {
    throw new Error("not implemented")
  }
  /** Called after every mutation of the log (record/revert/undo/revertAll). Returns unsubscribe. */
  subscribe(_fn: () => void): () => void {
    throw new Error("not implemented")
  }
}
