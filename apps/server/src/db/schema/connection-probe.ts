import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Infrastructure check only; no account or game data belongs in this table.
export const connectionProbe = pgTable("connection_probe", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
