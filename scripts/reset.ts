/** Wipe and rebuild the local database with fresh demo data. */
import { clearAllData, seedDemoData } from "../src/lib/demo/seed";
import { closeDb } from "../src/lib/db/client";

async function main() {
  console.log("Clearing database...");
  clearAllData();
  console.log("Seeding demo data...");
  const result = await seedDemoData();
  console.log(`Done. Headline agreement: ${result.headlineAgreementId}`);
  closeDb();
}

main().catch((error) => {
  console.error("Reset failed:", error);
  process.exit(1);
});
