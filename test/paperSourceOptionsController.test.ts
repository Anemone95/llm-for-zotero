import { assert } from "chai";
import { describe, it } from "mocha";
import { buildPaperSourceOptions } from "../src/modules/contextPanel/setupHandlers/controllers/paperSourceOptionsController";
import { getContextSourceModeDescriptor } from "../src/modules/contextPanel/contextSourceModes";
import type { PaperContextRef } from "../src/modules/contextPanel/types";

function makeParentItem(params: {
  id: number;
  attachmentIds: number[];
  title?: string;
}): Zotero.Item {
  return {
    id: params.id,
    isAttachment: () => false,
    isRegularItem: () => true,
    getAttachments: () => params.attachmentIds,
    getField: (field: string) => {
      if (field === "title") return params.title || "Parent paper";
      if (field === "firstCreator") return "Chandra";
      if (field === "year") return "2025";
      return "";
    },
  } as unknown as Zotero.Item;
}

function makeAttachment(params: {
  id: number;
  parentID: number;
  filename: string;
  contentType: string;
  title?: string;
}): Zotero.Item {
  return {
    id: params.id,
    parentID: params.parentID,
    attachmentFilename: params.filename,
    attachmentContentType: params.contentType,
    isAttachment: () => true,
    isRegularItem: () => false,
    getField: (field: string) =>
      field === "title" ? params.title || params.filename : "",
  } as unknown as Zotero.Item;
}

function buildOptionsForItems(params: {
  paperContext: PaperContextRef;
  items: Zotero.Item[];
}) {
  const itemsById = new Map(params.items.map((item) => [item.id, item]));
  return buildPaperSourceOptions({
    paperContext: params.paperContext,
    getItemById: (itemId) => itemsById.get(itemId) || null,
    webChatMode: false,
    pdfSupport: "native",
    isMineruEnabled: false,
    getItemStatus: () => undefined,
    isPaperContextMineru: () => false,
    mineruAvailableIds: new Set(),
    fullPdfUnsupportedMessage: "PDF unsupported",
    mineruDisabledParsingMessage: "",
    translate: (text) => text,
  });
}

describe("paper source options", function () {
  it("describes the single PDF path source mode", function () {
    const descriptor = getContextSourceModeDescriptor("pdf");

    assert.deepInclude(descriptor, {
      badgeLabel: "PDF",
      humanLabel: "PDF path",
      cssClassName: "llm-paper-context-chip-pdf",
      isReaderNavigable: true,
      isTextLikeAttachment: false,
    });
  });

  it("builds only one selectable PDF option for a PDF child attachment", function () {
    const parent = makeParentItem({ id: 10, attachmentIds: [11] });
    const pdf = makeAttachment({
      id: 11,
      parentID: 10,
      filename: "paper.pdf",
      contentType: "application/pdf",
      title: "Paper PDF",
    });

    const options = buildOptionsForItems({
      paperContext: {
        itemId: 10,
        contextItemId: 11,
        title: "Parent paper",
        attachmentTitle: "Paper PDF",
      },
      items: [parent, pdf],
    });

    assert.deepEqual(
      options.map((option) => option.mode),
      ["pdf"],
    );
    assert.deepInclude(options[0], {
      mode: "pdf",
      badge: "PDF",
      title: "Parent paper",
      description: "Paper PDF - PDF path",
    });
  });

  it("does not expose text-like attachment options as alternate paper modes", function () {
    const parent = makeParentItem({ id: 10, attachmentIds: [11, 12] });
    const pdf = makeAttachment({
      id: 11,
      parentID: 10,
      filename: "paper.pdf",
      contentType: "application/pdf",
    });
    const markdown = makeAttachment({
      id: 12,
      parentID: 10,
      filename: "notes.md",
      contentType: "text/markdown",
    });

    const options = buildOptionsForItems({
      paperContext: {
        itemId: 10,
        contextItemId: 11,
        title: "Parent paper",
        attachmentTitle: "Paper PDF",
      },
      items: [parent, pdf, markdown],
    });

    assert.deepEqual(
      options.map((option) => option.mode),
      ["pdf"],
    );
  });
});
