import { assert } from "chai";
import { auditConversationIntegrity } from "../src/shared/conversationIntegrity";

function installConversationIntegrityDb(params: {
  tables?: string[];
  countForSql?: (sql: string) => number;
}): { queries: string[]; restore: () => void } {
  const originalZotero = globalThis.Zotero;
  const tables = new Set(params.tables || []);
  const queries: string[] = [];
  (globalThis as typeof globalThis & { Zotero: typeof Zotero }).Zotero = {
    DB: {
      queryAsync: async (sql: string, queryParams?: unknown[]) => {
        queries.push(sql);
        if (sql.includes("FROM sqlite_master")) {
          const tableName = String(queryParams?.[0] || "");
          return tables.has(tableName) ? [{ name: tableName }] : [];
        }
        return [{ rowCount: params.countForSql?.(sql) || 0 }];
      },
    },
  } as unknown as typeof Zotero;

  return {
    queries,
    restore: () => {
      (globalThis as typeof globalThis & { Zotero?: typeof Zotero }).Zotero =
        originalZotero;
    },
  };
}

describe("conversation integrity audit", function () {
  it("returns a clean report when conversation tables do not exist yet", async function () {
    const { restore } = installConversationIntegrityDb({});
    try {
      const report = await auditConversationIntegrity();
      assert.deepEqual(report, { ok: true, issues: [] });
    } finally {
      restore();
    }
  });

  it("reports registry, catalog, and message integrity issues", async function () {
    const { queries, restore } = installConversationIntegrityDb({
      tables: [
        "llm_for_zotero_conversation_registry",
        "llm_for_zotero_global_conversations",
        "llm_for_zotero_paper_conversations",
        "llm_for_zotero_chat_messages",
      ],
      countForSql: (sql) => {
        if (
          sql.includes("FROM llm_for_zotero_conversation_registry") &&
          sql.includes("TRIM(conversation_id) = ''")
        ) {
          return 1;
        }
        if (
          sql.includes("FROM llm_for_zotero_conversation_registry") &&
          sql.includes("WHERE valid = 0")
        ) {
          return 2;
        }
        if (
          sql.includes("FROM llm_for_zotero_global_conversations") &&
          sql.includes("TRIM(conversation_id) = ''")
        ) {
          return 3;
        }
        if (
          sql.includes("FROM llm_for_zotero_chat_messages m") &&
          sql.includes("LEFT JOIN llm_for_zotero_global_conversations") &&
          sql.includes("LEFT JOIN llm_for_zotero_paper_conversations")
        ) {
          return 4;
        }
        return 0;
      },
    });

    try {
      const report = await auditConversationIntegrity();

      assert.isFalse(report.ok);
      assert.deepInclude(report.issues, {
        code: "registry_blank_conversation_id",
        tableName: "llm_for_zotero_conversation_registry",
        rowCount: 1,
      });
      assert.deepInclude(report.issues, {
        code: "registry_invalid_scope",
        tableName: "llm_for_zotero_conversation_registry",
        rowCount: 2,
      });
      assert.deepInclude(report.issues, {
        code: "catalog_blank_conversation_id",
        tableName: "llm_for_zotero_global_conversations",
        system: "upstream",
        rowCount: 3,
      });
      assert.deepInclude(report.issues, {
        code: "message_missing_catalog_row",
        tableName: "llm_for_zotero_chat_messages",
        system: "upstream",
        rowCount: 4,
      });
      assert.isTrue(
        queries.some(
          (sql) =>
            sql.includes("FROM llm_for_zotero_chat_messages m") &&
            sql.includes("llm_for_zotero_global_conversations") &&
            sql.includes("llm_for_zotero_paper_conversations"),
        ),
      );
    } finally {
      restore();
    }
  });
});
