import { createDbClient } from "./connection";
import { appMeta } from "./schema";

function main(): void {
  const { db, sqlite, dbPath } = createDbClient();
  try {
    const now = new Date().toISOString();
    db.insert(appMeta)
      .values({
        key: "schema_ready",
        value: "true",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appMeta.key,
        set: {
          value: "true",
          updatedAt: now,
        },
      })
      .run();
    console.log(`Database migrated successfully: ${dbPath}`);
  } finally {
    sqlite.close();
  }
}

main();
