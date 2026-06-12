import { assert } from "chai";
import {
  attachMenuActionController,
  buildResponseActionTargetFromHistory,
} from "../src/modules/contextPanel/setupHandlers/controllers/menuActionController";

class FakeElement {
  public dataset: Record<string, string | undefined> = {};
  public textContent = "";
  public className = "";
  public disabled = false;
  private readonly listeners = new Map<
    string,
    Array<(event: any) => unknown>
  >();

  addEventListener(type: string, listener: (event: any) => unknown): void {
    const existing = this.listeners.get(type) || [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  closest(selector: string): FakeElement | null {
    const classNames = new Set(this.className.split(/\s+/).filter(Boolean));
    const selectors = selector.split(",").map((part) => part.trim());
    for (const part of selectors) {
      if (!part.startsWith(".")) continue;
      if (classNames.has(part.slice(1))) return this;
    }
    return null;
  }

  async dispatch(type: string, target: FakeElement = this): Promise<void> {
    const event = {
      target,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    };
    for (const listener of this.listeners.get(type) || []) {
      await listener(event);
    }
  }
}

describe("menu action controller note routing", function () {
  const globalScope = globalThis as typeof globalThis & {
    Zotero?: {
      Item?: new (itemType: string) => Zotero.Item;
    };
    ztoolkit?: {
      log?: (...args: unknown[]) => void;
    };
  };
  const originalZotero = globalScope.Zotero;
  const originalZtoolkit = globalScope.ztoolkit;
  const savedNotes: MockNoteItem[] = [];

  class MockNoteItem {
    id = 0;
    libraryID = 0;
    parentID?: number;
    private noteHtml = "";

    constructor(itemType: string) {
      assert.equal(itemType, "note");
    }

    isNote() {
      return true;
    }

    setNote(html: string) {
      this.noteHtml = html;
    }

    getNote() {
      return this.noteHtml;
    }

    async saveTx() {
      if (!this.id) {
        this.id = 100 + savedNotes.length;
        savedNotes.push(this);
      }
      return this.id;
    }
  }

  beforeEach(function () {
    savedNotes.splice(0);
    globalScope.Zotero = {
      ...(originalZotero || {}),
      Item: MockNoteItem as unknown as new (itemType: string) => Zotero.Item,
    };
    globalScope.ztoolkit = {
      ...(originalZtoolkit || {}),
      log: () => {},
    };
  });

  afterEach(function () {
    if (originalZotero) {
      globalScope.Zotero = originalZotero;
    } else {
      delete globalScope.Zotero;
    }
    if (originalZtoolkit) {
      globalScope.ztoolkit = originalZtoolkit;
    } else {
      delete globalScope.ztoolkit;
    }
  });

  it("saves response-menu notes as standalone notes in library chat mode", async function () {
    const responseMenu = new FakeElement();
    const responseMenuNoteBtn = new FakeElement();
    const status = new FakeElement();
    const logErrors: unknown[] = [];
    const currentItem = {
      id: 42,
      libraryID: 1,
    } as unknown as Zotero.Item;

    attachMenuActionController({
      body: new FakeElement() as unknown as Element,
      status: status as unknown as HTMLElement,
      responseMenu: responseMenu as unknown as HTMLDivElement,
      responseMenuCopyBtn: new FakeElement() as unknown as HTMLButtonElement,
      responseMenuNoteBtn: responseMenuNoteBtn as unknown as HTMLButtonElement,
      responseMenuDeleteBtn: null,
      promptMenu: null,
      promptMenuDeleteBtn: null,
      exportMenu: null,
      exportMenuCopyBtn: null,
      exportMenuNoteBtn: null,
      exportBtn: null,
      popoutBtn: null,
      settingsBtn: null,
      preferencesPaneId: "llm-for-zotero-test",
      getItem: () => currentItem,
      getResponseMenuTarget: () => ({
        item: currentItem,
        contentText: "Generated a figure.",
        queryText: "What did the model generate?",
        modelName: "Codex",
      }),
      getPromptMenuTarget: () => null,
      getCurrentLibraryID: () => 1,
      getConversationSystem: () => "codex",
      getCurrentRuntimeModeForItem: () => "agent",
      isGlobalMode: () => true,
      ensureConversationLoaded: async () => {},
      getConversationKey: () => 1,
      getHistory: () => [],
      resolveActiveNoteSession: () => null,
      closeResponseMenu: () => {},
      closePromptMenu: () => {},
      closeExportMenu: () => {},
      closeRetryModelMenu: () => {},
      closeSlashMenu: () => {},
      closeHistoryNewMenu: () => {},
      closeHistoryMenu: () => {},
      queueTurnDeletion: async () => {},
      logError: (...args: unknown[]) => {
        logErrors.push(args);
      },
    });

    await responseMenuNoteBtn.dispatch("click");

    assert.lengthOf(savedNotes, 1);
    assert.equal(savedNotes[0].libraryID, 1);
    assert.isUndefined(savedNotes[0].parentID);
    assert.include(savedNotes[0].getNote(), "What did the model generate?");
    assert.include(savedNotes[0].getNote(), "Generated a figure.");
    assert.equal(status.textContent, "Created a new note");
    assert.isEmpty(logErrors);
  });

  it("reconstructs toolbar response targets from turn timestamps", function () {
    const currentItem = {
      id: 42,
      libraryID: 1,
    } as unknown as Zotero.Item;
    const paperContext = {
      itemId: 42,
      contextItemId: 77,
      title: "Paper title",
      citationKey: "paper2026",
    };
    const quoteCitation = {
      id: "Q_1",
      quoteText: "quoted text",
      citationLabel: "Paper, 2026",
      itemId: 42,
      contextItemId: 77,
    };
    const generatedImage = {
      id: "img-1",
      label: "result.png",
      src: "file:///tmp/result.png",
    };

    const target = buildResponseActionTargetFromHistory({
      item: currentItem,
      conversationKey: 9,
      userTimestamp: 100,
      assistantTimestamp: 200,
      history: [
        {
          role: "user",
          text: "Question about this paper",
          timestamp: 100,
          selectedTextPaperContexts: [paperContext],
        },
        {
          role: "assistant",
          text: "  Answer with citation.  ",
          timestamp: 200,
          modelName: " codex ",
          quoteCitations: [quoteCitation],
          generatedImages: [generatedImage],
        },
      ],
    });

    assert.isNotNull(target);
    assert.equal(target?.contentText, "Answer with citation.");
    assert.equal(target?.queryText, "Question about this paper");
    assert.equal(target?.modelName, "codex");
    assert.equal(target?.paperContexts?.[0]?.itemId, paperContext.itemId);
    assert.equal(
      target?.paperContexts?.[0]?.contextItemId,
      paperContext.contextItemId,
    );
    assert.equal(target?.paperContexts?.[0]?.title, paperContext.title);
    assert.equal(
      target?.paperContexts?.[0]?.citationKey,
      paperContext.citationKey,
    );
    assert.deepEqual(target?.quoteCitations, [quoteCitation]);
    assert.deepEqual(target?.generatedImages, [generatedImage]);
  });

  it("saves response notes as child item notes in paper chat mode", async function () {
    const responseMenu = new FakeElement();
    const responseMenuNoteBtn = new FakeElement();
    const status = new FakeElement();
    const logErrors: unknown[] = [];
    const currentItem = {
      id: 42,
      libraryID: 1,
      isAttachment: () => false,
      isNote: () => false,
    } as unknown as Zotero.Item;

    attachMenuActionController({
      body: new FakeElement() as unknown as Element,
      status: status as unknown as HTMLElement,
      responseMenu: responseMenu as unknown as HTMLDivElement,
      responseMenuCopyBtn: new FakeElement() as unknown as HTMLButtonElement,
      responseMenuNoteBtn: responseMenuNoteBtn as unknown as HTMLButtonElement,
      responseMenuDeleteBtn: null,
      promptMenu: null,
      promptMenuDeleteBtn: null,
      exportMenu: null,
      exportMenuCopyBtn: null,
      exportMenuNoteBtn: null,
      exportBtn: null,
      popoutBtn: null,
      settingsBtn: null,
      preferencesPaneId: "llm-for-zotero-test",
      getItem: () => currentItem,
      getResponseMenuTarget: () => ({
        item: currentItem,
        contentText: "Paper-specific answer.",
        queryText: "Summarize this paper.",
        modelName: "Codex",
      }),
      getPromptMenuTarget: () => null,
      getCurrentLibraryID: () => 1,
      getConversationSystem: () => "codex",
      getCurrentRuntimeModeForItem: () => "agent",
      isGlobalMode: () => false,
      ensureConversationLoaded: async () => {},
      getConversationKey: () => 1,
      getHistory: () => [],
      resolveActiveNoteSession: () => null,
      closeResponseMenu: () => {},
      closePromptMenu: () => {},
      closeExportMenu: () => {},
      closeRetryModelMenu: () => {},
      closeSlashMenu: () => {},
      closeHistoryNewMenu: () => {},
      closeHistoryMenu: () => {},
      queueTurnDeletion: async () => {},
      logError: (...args: unknown[]) => {
        logErrors.push(args);
      },
    });

    await responseMenuNoteBtn.dispatch("click");

    assert.lengthOf(savedNotes, 1);
    assert.equal(savedNotes[0].libraryID, 1);
    assert.equal(savedNotes[0].parentID, 42);
    assert.include(savedNotes[0].getNote(), "Summarize this paper.");
    assert.include(savedNotes[0].getNote(), "Paper-specific answer.");
    assert.equal(status.textContent, "Created a new note");
    assert.isEmpty(logErrors);
  });

  it("routes toolbar delete actions through queueTurnDeletion", async function () {
    const body = new FakeElement();
    const deleteBtn = new FakeElement();
    deleteBtn.className = "llm-message-action llm-message-action-delete";
    deleteBtn.dataset.responseAction = "delete";
    deleteBtn.dataset.conversationKey = "9";
    deleteBtn.dataset.userTimestamp = "100";
    deleteBtn.dataset.assistantTimestamp = "200";
    const currentItem = {
      id: 42,
      libraryID: 1,
    } as unknown as Zotero.Item;
    const deletions: unknown[] = [];

    attachMenuActionController({
      body: body as unknown as Element,
      status: new FakeElement() as unknown as HTMLElement,
      responseMenu: null,
      responseMenuCopyBtn: null,
      responseMenuNoteBtn: null,
      responseMenuDeleteBtn: null,
      promptMenu: null,
      promptMenuDeleteBtn: null,
      exportMenu: null,
      exportMenuCopyBtn: null,
      exportMenuNoteBtn: null,
      exportBtn: null,
      popoutBtn: null,
      settingsBtn: null,
      preferencesPaneId: "llm-for-zotero-test",
      getItem: () => currentItem,
      getResponseMenuTarget: () => null,
      getPromptMenuTarget: () => null,
      getCurrentLibraryID: () => 1,
      getConversationSystem: () => "codex",
      getCurrentRuntimeModeForItem: () => "agent",
      isGlobalMode: () => true,
      ensureConversationLoaded: async () => {},
      getConversationKey: () => 9,
      getHistory: () => [
        { role: "user", text: "Question", timestamp: 100 },
        { role: "assistant", text: "Answer", timestamp: 200 },
      ],
      resolveActiveNoteSession: () => null,
      closeResponseMenu: () => {},
      closePromptMenu: () => {},
      closeExportMenu: () => {},
      closeRetryModelMenu: () => {},
      closeSlashMenu: () => {},
      closeHistoryNewMenu: () => {},
      closeHistoryMenu: () => {},
      queueTurnDeletion: async (target) => {
        deletions.push(target);
      },
      logError: () => {},
    });

    await body.dispatch("click", deleteBtn);

    assert.deepEqual(deletions, [
      {
        conversationKey: 9,
        userTimestamp: 100,
        assistantTimestamp: 200,
      },
    ]);
  });

  it("does not queue toolbar delete when the turn target is stale", async function () {
    const body = new FakeElement();
    const deleteBtn = new FakeElement();
    deleteBtn.className = "llm-message-action llm-message-action-delete";
    deleteBtn.dataset.responseAction = "delete";
    deleteBtn.dataset.conversationKey = "9";
    deleteBtn.dataset.userTimestamp = "100";
    deleteBtn.dataset.assistantTimestamp = "200";
    const currentItem = {
      id: 42,
      libraryID: 1,
    } as unknown as Zotero.Item;
    let deletionCount = 0;

    attachMenuActionController({
      body: body as unknown as Element,
      status: new FakeElement() as unknown as HTMLElement,
      responseMenu: null,
      responseMenuCopyBtn: null,
      responseMenuNoteBtn: null,
      responseMenuDeleteBtn: null,
      promptMenu: null,
      promptMenuDeleteBtn: null,
      exportMenu: null,
      exportMenuCopyBtn: null,
      exportMenuNoteBtn: null,
      exportBtn: null,
      popoutBtn: null,
      settingsBtn: null,
      preferencesPaneId: "llm-for-zotero-test",
      getItem: () => currentItem,
      getResponseMenuTarget: () => null,
      getPromptMenuTarget: () => null,
      getCurrentLibraryID: () => 1,
      getConversationSystem: () => "codex",
      getCurrentRuntimeModeForItem: () => "agent",
      isGlobalMode: () => true,
      ensureConversationLoaded: async () => {},
      getConversationKey: () => 10,
      getHistory: () => [
        { role: "user", text: "Question", timestamp: 100 },
        { role: "assistant", text: "Answer", timestamp: 200 },
      ],
      resolveActiveNoteSession: () => null,
      closeResponseMenu: () => {},
      closePromptMenu: () => {},
      closeExportMenu: () => {},
      closeRetryModelMenu: () => {},
      closeSlashMenu: () => {},
      closeHistoryNewMenu: () => {},
      closeHistoryMenu: () => {},
      queueTurnDeletion: async () => {
        deletionCount += 1;
      },
      logError: () => {},
    });

    await body.dispatch("click", deleteBtn);

    assert.equal(deletionCount, 0);
  });
});
