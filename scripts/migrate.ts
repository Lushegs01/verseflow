/** Apply pending database migrations and report what has been applied. */
import { getDb, closeDb } from "../src/lib/db/client";

async function main() {
  // getDb() runs any pending migrations on first use.
  const db = await getDb();

  const { rows } = await db.query<{ name: string; applied_at: string }>(
    "SELECT name, applied_at FROM _migrations ORDER BY id",
  );

  console.log(`Applied ${rows.length} migration(s):`);
  for (const row of rows) {
    console.log(`  ${row.name}  (${new Date(row.applied_at).toISOString()})`);
  }

  console.log(
    `\nTarget: ${process.env.DATABASE_URL ? "Postgres (DATABASE_URL)" : "PGlite (embedded)"}`,
  );
  await closeDb();
}

main().catch((error) => {
  console.error("Migration check failed:", error);
  process.exit(1);
});
