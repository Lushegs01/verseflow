/** Apply pending database migrations. */
import { getDb, closeDb } from "../src/lib/db/client";

const db = getDb();
const applied = db.prepare("SELECT name, applied_at FROM _migrations ORDER BY id").all() as Array<{
  name: string;
  applied_at: string;
}>;

console.log(`Applied ${applied.length} migration(s):`);
for (const row of applied) console.log(`  ${row.name}  (${row.applied_at})`);
closeDb();
