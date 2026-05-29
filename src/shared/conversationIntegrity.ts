import type { ConversationSystem } from "./types";

type ZoteroDb = {
  queryAsync?: (sql: string, params?: unknown[]) => Promise<unknown>;
};

export type ConversationIntegrityIssueCode =
  | "registry_blank_conversation_id"
  | "registry_invalid_scope"
  | "catalog_blank_conversation_id"
  | "catalog_missing_registry_row"
  | "message_blank_conversation_id"
  | "message_missing_catalog_row";

export type ConversationIntegrityIssue = {
  code: ConversationIntegrityIssueCode;
  tableName: string;
  system?: ConversationSystem;
  rowCount: number;
};

export type ConversationIntegrityReport = {
  ok: boolean;
  issues: ConversationIntegrityIssue[];
};

const CONVERSATION_REGISTRY_TABLE = "llm_for_zotero_conversation_registry";

const CATALOG_TABLES: Array<{
  system: ConversationSystem;
  catalogTable: string;
}> = [
  {
    system: "upstream",
    catalogTable: "llm_for_zotero_global_conversations",
  },
  {
    system: "upstream",
    catalogTable: "llm_for_zotero_paper_conversations",
  },
  {
    system: "claude_code",
    catalogTable: "llm_for_zotero_claude_conversations",
  },
  {
    system: "codex",
    catalogTable: "llm_for_zotero_codex_conversations",
  },
];

const MESSAGE_TABLES: Array<{
  system: ConversationSystem;
  messageTable: string;
  catalogTables: string[];
}> = [
  {
    system: "upstream",
    messageTable: "llm_for_zotero_chat_messages",
    catalogTables: [
      "llm_for_zotero_global_conversations",
      "llm_for_zotero_paper_conversations",
    ],
  },
  {
    system: "claude_code",
    messageTable: "llm_for_zotero_claude_messages",
    catalogTables: ["llm_for_zotero_claude_conversations"],
  },
  {
    system: "codex",
    messageTable: "llm_for_zotero_codex_messages",
    catalogTables: ["llm_for_zotero_codex_conversations"],
  },
];

function getZoteroDb(): ZoteroDb | null {
  return (
    (globalThis as typeof globalThis & { Zotero?: { DB?: ZoteroDb } }).Zotero
      ?.DB || null
  );
}

async function tableExists(db: ZoteroDb, tableName: string): Promise<boolean> {
  const rows = (await db.queryAsync?.(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table'
       AND name = ?
     LIMIT 1`,
    [tableName],
  )) as Array<{ name?: unknown }> | undefined;
  return Boolean(rows?.length);
}

async function countRows(
  db: ZoteroDb,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const rows = (await db.queryAsync?.(sql, params)) as
    | Array<{ rowCount?: unknown }>
    | undefined;
  const rowCount = Number(rows?.[0]?.rowCount);
  return Number.isFinite(rowCount) ? Math.max(0, Math.floor(rowCount)) : 0;
}

function addIssue(
  issues: ConversationIntegrityIssue[],
  issue: ConversationIntegrityIssue,
): void {
  if (issue.rowCount <= 0) return;
  issues.push(issue);
}

export async function auditConversationIntegrity(): Promise<ConversationIntegrityReport> {
  const db = getZoteroDb();
  if (!db?.queryAsync) {
    return { ok: true, issues: [] };
  }

  const issues: ConversationIntegrityIssue[] = [];
  const registryExists = await tableExists(db, CONVERSATION_REGISTRY_TABLE);

  if (registryExists) {
    addIssue(issues, {
      code: "registry_blank_conversation_id",
      tableName: CONVERSATION_REGISTRY_TABLE,
      rowCount: await countRows(
        db,
        `SELECT COUNT(*) AS rowCount
         FROM ${CONVERSATION_REGISTRY_TABLE}
         WHERE conversation_id IS NULL
            OR TRIM(conversation_id) = ''`,
      ),
    });
    addIssue(issues, {
      code: "registry_invalid_scope",
      tableName: CONVERSATION_REGISTRY_TABLE,
      rowCount: await countRows(
        db,
        `SELECT COUNT(*) AS rowCount
         FROM ${CONVERSATION_REGISTRY_TABLE}
         WHERE valid = 0`,
      ),
    });
  }

  for (const store of CATALOG_TABLES) {
    const catalogExists = await tableExists(db, store.catalogTable);

    if (catalogExists) {
      addIssue(issues, {
        code: "catalog_blank_conversation_id",
        tableName: store.catalogTable,
        system: store.system,
        rowCount: await countRows(
          db,
          `SELECT COUNT(*) AS rowCount
           FROM ${store.catalogTable}
           WHERE conversation_id IS NULL
              OR TRIM(conversation_id) = ''`,
        ),
      });

      if (registryExists) {
        addIssue(issues, {
          code: "catalog_missing_registry_row",
          tableName: store.catalogTable,
          system: store.system,
          rowCount: await countRows(
            db,
            `SELECT COUNT(*) AS rowCount
             FROM ${store.catalogTable} c
             LEFT JOIN ${CONVERSATION_REGISTRY_TABLE} r
               ON r.conversation_id = c.conversation_id
             WHERE c.conversation_id IS NOT NULL
               AND TRIM(c.conversation_id) <> ''
               AND r.conversation_id IS NULL`,
          ),
        });
      }
    }
  }

  for (const store of MESSAGE_TABLES) {
    const messageExists = await tableExists(db, store.messageTable);
    if (!messageExists) continue;

    addIssue(issues, {
      code: "message_blank_conversation_id",
      tableName: store.messageTable,
      system: store.system,
      rowCount: await countRows(
        db,
        `SELECT COUNT(*) AS rowCount
         FROM ${store.messageTable}
         WHERE conversation_id IS NULL
            OR TRIM(conversation_id) = ''`,
      ),
    });

    const existingCatalogs = [];
    for (const catalogTable of store.catalogTables) {
      if (await tableExists(db, catalogTable)) existingCatalogs.push(catalogTable);
    }
    if (existingCatalogs.length) {
      const joins = existingCatalogs
        .map(
          (catalogTable, index) =>
            `LEFT JOIN ${catalogTable} c${index}
             ON c${index}.conversation_id = m.conversation_id`,
        )
        .join("\n");
      const missingPredicates = existingCatalogs
        .map((_, index) => `c${index}.conversation_id IS NULL`)
        .join("\n               AND ");
      addIssue(issues, {
        code: "message_missing_catalog_row",
        tableName: store.messageTable,
        system: store.system,
        rowCount: await countRows(
          db,
          `SELECT COUNT(*) AS rowCount
           FROM ${store.messageTable} m
           ${joins}
           WHERE m.conversation_id IS NOT NULL
             AND TRIM(m.conversation_id) <> ''
             AND ${missingPredicates}`,
        ),
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
