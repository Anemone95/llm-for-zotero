export type ConversationDraftSummary = {
  conversationKey?: number | null;
  kind?: "global" | "paper" | string | null;
  libraryID?: number | null;
  userTurnCount?: number | null;
};

export type StandaloneDraftSummary = ConversationDraftSummary;

function normalizePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function hasNoUserTurns(summary: ConversationDraftSummary): boolean {
  return (Number(summary.userTurnCount || 0) || 0) === 0;
}

export function isReusableConversationDraft(params: {
  forceFresh?: boolean;
  summary: ConversationDraftSummary | null | undefined;
  kind?: "global" | "paper";
  libraryID?: number | null;
}): boolean {
  if (params.forceFresh) return false;
  const summary = params.summary;
  if (!summary) return false;
  if (params.kind && summary.kind !== params.kind) return false;
  if (params.kind === "global") {
    const expectedLibraryID = normalizePositiveInt(params.libraryID);
    const summaryLibraryID = normalizePositiveInt(summary.libraryID);
    if (!expectedLibraryID || summaryLibraryID !== expectedLibraryID) {
      return false;
    }
  }
  return hasNoUserTurns(summary);
}

export function findReusableConversationDraft<
  T extends ConversationDraftSummary,
>(params: {
  forceFresh?: boolean;
  summaries: readonly T[];
  kind?: "global" | "paper";
  libraryID?: number | null;
}): T | null {
  if (params.forceFresh) return null;
  return (
    params.summaries.find((summary) =>
      isReusableConversationDraft({
        forceFresh: params.forceFresh,
        summary,
        kind: params.kind,
        libraryID: params.libraryID,
      }),
    ) || null
  );
}

export function isReusableStandaloneDraft(params: {
  forceFresh?: boolean;
  summary: StandaloneDraftSummary | null | undefined;
  kind: "global" | "paper";
  libraryID?: number | null;
}): boolean {
  return isReusableConversationDraft(params);
}

export function findReusableStandaloneDraft<
  T extends StandaloneDraftSummary,
>(params: {
  forceFresh?: boolean;
  summaries: readonly T[];
  kind?: "global" | "paper";
  libraryID?: number | null;
}): T | null {
  return findReusableConversationDraft(params);
}
