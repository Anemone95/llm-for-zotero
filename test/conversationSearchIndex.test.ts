import { assert } from "chai";
import {
  CONVERSATION_SEARCH_INDEX_TABLE,
  deleteConversationSearchIndexRow,
  initConversationSearchIndexStore,
  refreshConversationSearchIndex,
  refreshConversationSearchIndexForConversation,
  refreshConversationSearchIndexForSystem,
  searchConversationIndex,
} from "../src/shared/conversationSearchIndex";

describe("conversation search index", function () {
  const globalScope = globalThis as typeof globalThis & {
    Zotero?: Record<string, unknown>;
  };
  const originalZotero = globalScope.Zotero;

  afterEach(function () {
    globalScope.Zotero = originalZotero;
  });

  function installSearchIndexDb(params: {
    tables?: string[];
    searchRows?: Array<Record<string, unknown>>;
  } = {}) {
    const tables = new Set(params.tables || []);
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    globalScope.Zotero = {
      DB: {
        queryAsync: async (sql: string, queryParams?: unknown[]) => {
          queries.push({ sql, params: queryParams });
          if (sql.includes("FROM sqlite_master")) {
            const tableName = String(queryParams?.[0] || "");
            return tables.has(tableName) ? [{ name: tableName }] : [];
          }
          if (
            sql.includes(`FROM ${CONVERSATION_SEARCH_INDEX_TABLE}`) &&
            sql.includes("WHERE system = ?") &&
            sql.includes("body_text AS bodyText")
          ) {
            return params.searchRows || [];
          }
          return [];
        },
      },
    };
    return { queries };
  }

  it("initializes a DB-backed search index table", async function () {
    const { queries } = installSearchIndexDb();

    assert.equal(await initConversationSearchIndexStore(), true);

    assert.isTrue(
      queries.some(
        ({ sql }) =>
          sql.includes("CREATE TABLE IF NOT EXISTS") &&
          sql.includes(CONVERSATION_SEARCH_INDEX_TABLE) &&
          sql.includes("conversation_id TEXT PRIMARY KEY") &&
          sql.includes("body_text TEXT NOT NULL"),
      ),
    );
    assert.isTrue(
      queries.some(
        ({ sql }) =>
          sql.includes("CREATE INDEX IF NOT EXISTS") &&
          sql.includes("(system, library_id, user_turn_count, last_activity_at DESC)"),
      ),
    );
  });

  it("refreshes upstream, Claude, and Codex catalogs into the shared index", async function () {
    const { queries } = installSearchIndexDb({
      tables: [
        "llm_for_zotero_global_conversations",
        "llm_for_zotero_paper_conversations",
        "llm_for_zotero_chat_messages",
        "llm_for_zotero_claude_conversations",
        "llm_for_zotero_claude_messages",
        "llm_for_zotero_codex_conversations",
        "llm_for_zotero_codex_messages",
      ],
    });

    assert.equal(await refreshConversationSearchIndex(), true);

    assert.isTrue(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT OR REPLACE INTO") &&
          sql.includes("llm_for_zotero_global_conversations") &&
          sql.includes("llm_for_zotero_chat_messages") &&
          !sql.includes("c.updated_at") &&
          params?.[0] === "upstream",
      ),
    );
    assert.isTrue(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT OR REPLACE INTO") &&
          sql.includes("llm_for_zotero_claude_conversations") &&
          sql.includes("llm_for_zotero_claude_messages") &&
          params?.[0] === "claude_code",
      ),
    );
    assert.isTrue(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT OR REPLACE INTO") &&
          sql.includes("llm_for_zotero_codex_conversations") &&
          sql.includes("llm_for_zotero_codex_messages") &&
          params?.[0] === "codex",
      ),
    );
  });

  it("searches indexed rows by current system and library", async function () {
    const { queries } = installSearchIndexDb({
      tables: [
        "llm_for_zotero_codex_conversations",
        "llm_for_zotero_codex_messages",
      ],
      searchRows: [
        {
          conversationID: "codex-chat-1",
          conversationKey: 8101,
          system: "codex",
          kind: "paper",
          libraryID: 2,
          paperItemID: 44,
          title: "Decoder margin",
          bodyText: "A discussion of stable decoding under drift.",
          lastActivityAt: 1234,
          userTurnCount: 2,
        },
      ],
    });

    const rows = await searchConversationIndex({
      system: "codex",
      libraryID: 2,
      query: "decoder drift",
      limit: 10,
    });

    assert.deepEqual(rows, [
      {
        conversationID: "codex-chat-1",
        conversationKey: 8101,
        system: "codex",
        kind: "paper",
        libraryID: 2,
        paperItemID: 44,
        title: "Decoder margin",
        bodyText: "A discussion of stable decoding under drift.",
        lastActivityAt: 1234,
        userTurnCount: 2,
      },
    ]);
    const searchQuery = queries.find(
      ({ sql }) =>
        sql.includes(`FROM ${CONVERSATION_SEARCH_INDEX_TABLE}`) &&
        sql.includes("body_text AS bodyText"),
    );
    assert.deepEqual(searchQuery?.params, [
      "codex",
      2,
      "%decoder%",
      "%decoder%",
      "%drift%",
      "%drift%",
      10,
    ]);
  });

  it("does not refresh missing store tables", async function () {
    const { queries } = installSearchIndexDb();

    assert.equal(await refreshConversationSearchIndexForSystem("claude_code"), true);

    assert.isFalse(
      queries.some(
        ({ sql }) =>
          sql.includes("INSERT OR REPLACE INTO") &&
          sql.includes("llm_for_zotero_claude_conversations"),
      ),
    );
  });

  it("refreshes one indexed conversation by legacy key", async function () {
    const { queries } = installSearchIndexDb({
      tables: [
        "llm_for_zotero_global_conversations",
        "llm_for_zotero_paper_conversations",
        "llm_for_zotero_chat_messages",
      ],
    });

    assert.equal(
      await refreshConversationSearchIndexForConversation({
        system: "upstream",
        conversationKey: 1005,
      }),
      true,
    );

    const refreshQueries = queries.filter(
      ({ sql }) =>
        sql.includes("INSERT OR REPLACE INTO") &&
        sql.includes(CONVERSATION_SEARCH_INDEX_TABLE),
    );
    assert.lengthOf(refreshQueries, 2);
    assert.isTrue(
      refreshQueries.every(
        ({ sql, params }) =>
          sql.includes("AND (c.conversation_key = ?)") &&
          params?.[0] === "upstream" &&
          params?.[2] === 1005,
      ),
    );
  });

  it("refreshes one indexed conversation by canonical id", async function () {
    const { queries } = installSearchIndexDb({
      tables: [
        "llm_for_zotero_codex_conversations",
        "llm_for_zotero_codex_messages",
      ],
    });

    assert.equal(
      await refreshConversationSearchIndexForConversation({
        system: "codex",
        conversationID: "lfz:user:codex:global:lib-1:legacy-8101",
        conversationKey: 8101,
      }),
      true,
    );

    const refreshQuery = queries.find(
      ({ sql }) =>
        sql.includes("INSERT OR REPLACE INTO") &&
        sql.includes("llm_for_zotero_codex_conversations"),
    );
    assert.isOk(refreshQuery);
    assert.include(refreshQuery?.sql || "", "AND (c.conversation_id = ?)");
    assert.deepEqual(refreshQuery?.params, [
      "codex",
      refreshQuery?.params?.[1],
      "lfz:user:codex:global:lib-1:legacy-8101",
    ]);
  });

  it("deletes indexed rows by id or scoped legacy key", async function () {
    const { queries } = installSearchIndexDb();

    assert.equal(
      await deleteConversationSearchIndexRow({
        conversationID: "lfz:user:codex:paper:lib-1:paper-44:legacy-8101",
      }),
      true,
    );
    assert.equal(
      await deleteConversationSearchIndexRow({
        system: "claude_code",
        conversationKey: 7101,
      }),
      true,
    );

    const deletes = queries.filter(({ sql }) =>
      sql.includes(`DELETE FROM ${CONVERSATION_SEARCH_INDEX_TABLE}`),
    );
    assert.lengthOf(deletes, 2);
    assert.include(deletes[0].sql, "WHERE conversation_id = ?");
    assert.deepEqual(deletes[0].params, [
      "lfz:user:codex:paper:lib-1:paper-44:legacy-8101",
    ]);
    assert.include(deletes[1].sql, "WHERE system = ?");
    assert.include(deletes[1].sql, "AND legacy_conversation_key = ?");
    assert.deepEqual(deletes[1].params, ["claude_code", 7101]);
  });
});
