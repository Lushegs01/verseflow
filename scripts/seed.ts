/**
 * Seed the local database with demo data.
 *
 *   npm run db:seed     add demo data (no-op if already seeded)
 *   npm run db:reset    wipe and re-seed
 */

import { seedDemoData, isSeeded, clearAllData } from "../src/lib/demo/seed";
import { closeDb } from "../src/lib/db/client";
import { computeReputation } from "../src/lib/services/reputation";
import { computeProductMetrics } from "../src/lib/services/analytics";
import { formatMoney } from "../src/lib/domain/money";

async function main() {
  const force = process.argv.includes("--force");

  if (isSeeded() && !force) {
    console.log("Demo data is already present. Use `npm run db:reset` to rebuild it.");
    closeDb();
    return;
  }

  if (force) {
    console.log("Clearing existing data...");
    clearAllData();
  }

  console.log("Seeding demo data...");
  const result = await seedDemoData();

  const reputation = computeReputation(result.alexId);
  const metrics = computeProductMetrics();

  console.log("");
  console.log("Seeded successfully.");
  console.log("");
  console.log("  Provider reputation (computed, not written):");
  console.log(`    Contracts completed   ${reputation.contractsCompleted}`);
  console.log(`    Value settled         ${formatMoney(reputation.valueSettled, "USDC")}`);
  console.log(`    On time               ${reputation.onTimeRate}%`);
  console.log(`    Milestone success     ${reputation.milestoneSuccessRate}%`);
  console.log(`    Disputes              ${reputation.disputeCount}`);
  console.log(`    Repeat clients        ${reputation.repeatClientRate}%`);
  console.log(`    Avg completion        ${reputation.avgCompletionDays} days`);
  console.log("");
  console.log("  Product metrics:");
  console.log(`    Agreements            ${metrics.agreementsCreated}`);
  console.log(`    Payment volume        ${formatMoney(metrics.paymentVolume, "USDC")}`);
  console.log(`    Milestones completed  ${metrics.milestonesCompleted}`);
  console.log(`    Dispute rate          ${metrics.disputeRate}%`);
  console.log("");
  console.log("  Start the app and open one of these:");
  console.log("    http://localhost:3000/api/demo/start?persona=client     (Northstar Coffee)");
  console.log("    http://localhost:3000/api/demo/start?persona=provider   (Alex Morgan)");
  console.log("    http://localhost:3000/api/demo/start?persona=operator   (Operations)");
  console.log("");

  closeDb();
}

main().catch((error) => {
  console.error("Seeding failed:", error);
  process.exit(1);
});
