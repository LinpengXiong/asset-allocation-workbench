import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const datasetVersions = sqliteTable(
  "dataset_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    asOf: text("as_of").notNull(),
    collectedAt: text("collected_at").notNull(),
    status: text("status").notNull(),
    payloadJson: text("payload_json").notNull(),
    checksum: text("checksum").notNull().unique(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("dataset_versions_collected_at_idx").on(table.collectedAt, table.id)],
);
