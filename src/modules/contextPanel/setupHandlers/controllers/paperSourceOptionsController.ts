import type { PaperContentSourceMode, PaperContextRef } from "../../types";
import { resolveContextAttachmentSupport } from "../../contextAttachmentSupport";
import {
  getContextSourceModeBadgeLabel,
  getContextSourceModeHumanLabel,
} from "../../contextSourceModes";
import { sanitizeText } from "../../textUtils";

export type PaperSourceModeOption = {
  mode?: PaperContentSourceMode | null;
};

export type PaperSourceOption = {
  mode: PaperContentSourceMode;
  badge: string;
  paperContext: PaperContextRef;
  title: string;
  description: string;
  disabledReason?: string;
};

export type BuildPaperSourceOptionsParams = {
  paperContext: PaperContextRef;
  getItemById: (itemId: number) => Zotero.Item | null | undefined;
  translate?: (text: string) => string;
};

function getAttachmentFilename(attachment: Zotero.Item): string {
  return sanitizeText(
    String(
      (attachment as unknown as { attachmentFilename?: unknown })
        .attachmentFilename || "",
    ),
  ).trim();
}

function getAttachmentCardTitle(attachment: Zotero.Item): string {
  return sanitizeText(
    String(
      attachment.getField("title") ||
        getAttachmentFilename(attachment) ||
        `Attachment ${attachment.id}`,
    ),
  ).trim();
}

function resolveParentItemForSourcePicker(
  paperContext: PaperContextRef,
  getItemById: BuildPaperSourceOptionsParams["getItemById"],
): Zotero.Item | null {
  const parent = getItemById(paperContext.itemId) || null;
  if (parent?.isRegularItem?.()) return parent;
  const attachment = getItemById(paperContext.contextItemId) || null;
  if (attachment?.isAttachment?.() && attachment.parentID) {
    const attachmentParent = getItemById(attachment.parentID) || null;
    if (attachmentParent?.isRegularItem?.()) return attachmentParent;
  }
  return null;
}

function buildPaperContextForChildAttachment(
  parentItem: Zotero.Item,
  attachment: Zotero.Item,
  mode: PaperContentSourceMode,
): PaperContextRef | null {
  const normalizedParentId = Math.floor(Number(parentItem.id));
  const normalizedAttachmentId = Math.floor(Number(attachment.id));
  if (
    !Number.isFinite(normalizedParentId) ||
    normalizedParentId <= 0 ||
    !Number.isFinite(normalizedAttachmentId) ||
    normalizedAttachmentId <= 0
  ) {
    return null;
  }
  const title = sanitizeText(
    String(parentItem.getField("title") || `Paper ${normalizedParentId}`),
  ).trim();
  const firstCreator = sanitizeText(
    String(
      parentItem.getField("firstCreator") ||
        (parentItem as Zotero.Item).firstCreator ||
        "",
    ),
  ).trim();
  const year = sanitizeText(
    String(
      parentItem.getField("year") ||
        parentItem.getField("date") ||
        parentItem.getField("issued") ||
        "",
    ),
  ).trim();
  const citationKey = sanitizeText(
    String(parentItem.getField("citationKey") || ""),
  ).trim();
  return {
    itemId: normalizedParentId,
    contextItemId: normalizedAttachmentId,
    contentSourceMode: mode,
    title: title || `Paper ${normalizedParentId}`,
    attachmentTitle: getAttachmentCardTitle(attachment) || undefined,
    citationKey: citationKey || undefined,
    firstCreator: firstCreator || undefined,
    year: year || undefined,
  };
}

export function buildPaperSourceOptions(
  params: BuildPaperSourceOptionsParams,
): PaperSourceOption[] {
  const parentItem = resolveParentItemForSourcePicker(
    params.paperContext,
    params.getItemById,
  );
  if (!parentItem) {
    const mode = params.paperContext.contentSourceMode || "pdf";
    return [
      {
        mode,
        badge: getContextSourceModeBadgeLabel(mode) || "PDF",
        paperContext: {
          ...params.paperContext,
          contentSourceMode: mode,
        },
        title: params.paperContext.title,
        description:
          params.paperContext.attachmentTitle ||
          getContextSourceModeHumanLabel(mode),
      },
    ];
  }

  const attachmentIds = parentItem.getAttachments?.() || [];
  const options: PaperSourceOption[] = [];
  for (const attachmentId of attachmentIds) {
    const attachment = params.getItemById(attachmentId) || null;
    if (!attachment?.isAttachment?.()) continue;
    const attachmentTitle = getAttachmentCardTitle(attachment);
    const attachmentSupport = resolveContextAttachmentSupport(attachment);
    if (attachmentSupport?.kind === "pdf") {
      const context = buildPaperContextForChildAttachment(
        parentItem,
        attachment,
        "pdf",
      );
      if (!context) continue;
      options.push({
        mode: "pdf",
        badge: getContextSourceModeBadgeLabel("pdf") || "PDF",
        paperContext: { ...context, contentSourceMode: "pdf" },
        title: context.title,
        description: `${attachmentTitle} - ${getContextSourceModeHumanLabel(
          "pdf",
        )}`,
      });
      continue;
    }
  }
  return options;
}
