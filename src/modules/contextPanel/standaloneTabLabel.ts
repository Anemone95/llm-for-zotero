import { resolveActiveNoteSession } from "./portalScope";

export type StandalonePaperTabLabel =
  | "Note editing"
  | "Paper chat";

export function resolveStandalonePaperTabLabel(options?: {
  paperSlotItem?: Zotero.Item | null;
}): StandalonePaperTabLabel {
  return resolveActiveNoteSession(options?.paperSlotItem || null)
    ? "Note editing"
    : "Paper chat";
}
