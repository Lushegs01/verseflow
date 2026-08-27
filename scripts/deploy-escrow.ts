/**
 * Deploy VerseFlowEscrow and verify it is genuinely live before reporting success.
 *
 * Run by a human holding the deploying key. The key is read from the environment at
 * run time and is never logged, echoed, or written anywhere.
 *
 *   DEPLOYER_PRIVATE_KEY=0x…  VERSE_RPC_URL=https://…  ARBITER_ADDRESS=0x… \
 *     npm run contract:deploy -- --yes
 *
 * The same rule the product applies to settlement applies here: a transaction hash is
 * not success. Nothing is reported as deployed until the receipt says `success`, code
 * exists at the address, and a call against the deployed contract returns the arbiter
 * that was actually constructed.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  isAddress,
  getAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = process.cwd();
const ARTIFACT = join(ROOT, "contracts", "artifacts", "VerseFlowEscrow.json");
const SOURCE = join(ROOT, "contracts", "VerseFlowEscrow.sol");

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is not set.`);
  return value;
}

function loadArtifact() {
  let raw: string;
  try {
    raw = readFileSync(ARTIFACT, "utf8");
  } catch {
    fail("No compiled artifact. Run `npm run contract:compile` first.");
  }

  const artifact = JSON.parse(raw) as {
    abi: unknown[]; bytecode: Hex; compiler: string; sourceHash?: string;
  };

  // A stale artifact would deploy code that does not match the source in the repo.
  // Compared by content because git does not preserve modification times.
  const actual = createHash("sha256").update(readFileSync(SOURCE)).digest("hex");
  if (artifact.sourceHash !== actual) {
    fail(
      [
        "The artifact was built from a different VerseFlowEscrow.sol than the one in the repo.",
        `  artifact: ${artifact.sourceHash ?? "(none recorded)"}`,
        `  source:   ${actual}`,
        "Run `npm run contract:compile` first.",
      ].join("\n"),
    );
  }
  if (!artifact.bytecode?.startsWith("0x") || artifact.bytecode.length < 4) {
    fail("Artifact contains no bytecode. Re-run `npm run contract:compile`.");
  }
  return artifact;
}

async function main() {
  const confirmed = process.argv.includes("--yes");

  const rpcUrl = required("VERSE_RPC_URL");
  const arbiterRaw = required("ARBITER_ADDRESS");
  const privateKey = required("DEPLOYER_PRIVATE_KEY");

  if (!isAddress(arbiterRaw)) fail(`ARBITER_ADDRESS is not a valid address: ${arbiterRaw}`);
  const arbiter = getAddress(arbiterRaw);
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    fail("DEPLOYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.");
  }

  const artifact = loadArtifact();
  const account = privateKeyToAccount(privateKey as Hex);

  // ---- Preflight ---------------------------------------------------------
  const probe = createPublicClient({ transport: http(rpcUrl) });

  let chainId: number;
  try {
    chainId = await probe.getChainId();
  } catch (error) {
    fail(`Cannot reach the RPC endpoint.\n  ${error instanceof Error ? error.message : String(error)}`);
  }

  const expected = process.env.NEXT_PUBLIC_VERSE_CHAIN_ID?.trim();
  if (expected && Number(expected) !== chainId) {
    fail(
      `Chain mismatch. The RPC reports chain ${chainId}, but NEXT_PUBLIC_VERSE_CHAIN_ID is ${expected}.\n` +
        "Deploying here would leave the application pointed at a different chain than the contract.",
    );
  }

  const chain = defineChain({
    id: chainId,
    name: process.env.NEXT_PUBLIC_VERSE_CHAIN_NAME ?? `Chain ${chainId}`,
    nativeCurrency: {
      name: process.env.NEXT_PUBLIC_VERSE_CURRENCY_SYMBOL ?? "ETH",
      symbol: process.env.NEXT_PUBLIC_VERSE_CURRENCY_SYMBOL ?? "ETH",
      decimals: 18,
    },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const balance = await publicClient.getBalance({ address: account.address });
  const symbol = chain.nativeCurrency.symbol;

  let gasEstimate: bigint | null = null;
  try {
    gasEstimate = await publicClient.estimateGas({
      account,
      data: `${artifact.bytecode}${arbiter.slice(2).toLowerCase().padStart(64, "0")}` as Hex,
    });
  } catch {
    // Some RPCs refuse to estimate deployment gas; not fatal.
  }

  console.log("Deployment plan");
  console.log(`  chain      ${chain.name} (id ${chainId})`);
  console.log(`  rpc        ${rpcUrl}`);
  console.log(`  deployer   ${account.address}`);
  console.log(`  balance    ${formatEther(balance)} ${symbol}`);
  console.log(`  arbiter    ${arbiter}`);
  console.log(`  compiler   ${artifact.compiler}`);
  if (gasEstimate !== null) console.log(`  est. gas   ${gasEstimate.toLocaleString()}`);

  if (balance === 0n) {
    fail(`Deployer has a zero balance. Fund ${account.address} with ${symbol} before deploying.`);
  }
  if (!confirmed) {
    console.log("\nThis spends gas from the account above. Re-run with --yes to proceed.");
    return;
  }

  // ---- Deploy ------------------------------------------------------------
  console.log("\nDeploying…");
  const hash = await wallet.deployContract({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode,
    args: [arbiter],
  });
  console.log(`  tx ${hash}`);

  const confirmations = Number(process.env.VERSE_CONFIRMATIONS ?? 1) || 1;
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations });

  // A receipt is not success. Check what it actually says.
  if (receipt.status !== "success") {
    fail(`Deployment reverted. Transaction ${hash} has status "${receipt.status}".`);
  }
  const address = receipt.contractAddress;
  if (!address) fail(`Receipt for ${hash} carries no contract address.`);

  // ---- Verify it is genuinely live ---------------------------------------
  const code = await publicClient.getCode({ address });
  if (!code || code === "0x") {
    fail(`No code at ${address} after deployment. Do not point the application at it.`);
  }

  const onChainArbiter = (await publicClient.readContract({
    address,
    abi: artifact.abi as never,
    functionName: "arbiter",
  })) as string;

  if (getAddress(onChainArbiter) !== arbiter) {
    fail(`Deployed arbiter is ${onChainArbiter}, expected ${arbiter}. Constructor did not take effect.`);
  }

  console.log(`\nVerified live.`);
  console.log(`  address    ${address}`);
  console.log(`  block      ${receipt.blockNumber}`);
  console.log(`  gas used   ${receipt.gasUsed.toLocaleString()}`);
  console.log(`  code size  ${(code.length - 2) / 2} bytes`);
  console.log(`  arbiter    ${onChainArbiter} (read back from chain)`);

  console.log(`\nSet these to switch settlement to live:\n`);
  console.log(`  NEXT_PUBLIC_SETTLEMENT_MODE=live`);
  console.log(`  VERSE_RPC_URL=${rpcUrl}`);
  console.log(`  VERSE_ESCROW_ADDRESS=${address}`);
  console.log(`  NEXT_PUBLIC_VERSE_CHAIN_ID=${chainId}`);
  console.log(
    `\nThe application stays simulated until both VERSE_RPC_URL and VERSE_ESCROW_ADDRESS are set.\n`,
  );
}

main().catch((error) => {
  console.error(`\nDeployment failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
