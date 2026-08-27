/**
 * Compile VerseFlowEscrow.sol and verify the application's ABI still matches it.
 *
 * The second half is the point. `src/lib/chain/abi.ts` is hand-written so that viem
 * can infer argument types from it, which means nothing otherwise stops it drifting
 * from the Solidity source -- and a drift does not surface until a real settlement
 * reverts on chain. This turns that into a build failure.
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { toFunctionSignature, toEventSignature } from "viem";
import { VERSEFLOW_ESCROW_ABI } from "../src/lib/chain/abi";
// solc is CommonJS and ships no useful types.
import solcModule from "solc";

const solc = solcModule as unknown as { compile: (input: string) => string; version: () => string };

// npm scripts run from the package root.
const ROOT = process.cwd();
const SOURCE = join(ROOT, "contracts", "VerseFlowEscrow.sol");
const OUT_DIR = join(ROOT, "contracts", "artifacts");
const OUT_FILE = join(OUT_DIR, "VerseFlowEscrow.json");

/** EIP-170 caps deployed contract size. */
const MAX_DEPLOYED_BYTES = 24576;

interface AbiEntry {
  type: string;
  name?: string;
  inputs?: unknown[];
  outputs?: unknown[];
}

function signature(entry: AbiEntry): string | null {
  try {
    if (entry.type === "function") return `function ${toFunctionSignature(entry as never)}`;
    if (entry.type === "event") return `event ${toEventSignature(entry as never)}`;
    if (entry.type === "error") {
      return `error ${toFunctionSignature({ ...entry, type: "function", outputs: [] } as never)}`;
    }
  } catch {
    return null;
  }
  return null; // constructor, receive, fallback -- not addressable by signature
}

function compile() {
  const input = {
    language: "Solidity",
    sources: { "VerseFlowEscrow.sol": { content: readFileSync(SOURCE, "utf8") } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // OP Stack chains lag mainnet on opcode support; paris avoids emitting PUSH0.
      evmVersion: "paris",
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const diagnostics: Array<{ severity: string; formattedMessage: string }> = output.errors ?? [];
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  for (const w of warnings) console.warn(w.formattedMessage);
  if (errors.length > 0) {
    for (const e of errors) console.error(e.formattedMessage);
    throw new Error(`Compilation failed with ${errors.length} error(s).`);
  }

  const contract = output.contracts["VerseFlowEscrow.sol"].VerseFlowEscrow;
  return {
    abi: contract.abi as AbiEntry[],
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedSize: contract.evm.deployedBytecode.object.length / 2,
    warnings: warnings.length,
  };
}

/**
 * Every entry the application declares must exist in the compiled contract. The
 * reverse is not required: the contract carries custom errors and events the
 * application has no reason to decode.
 */
function checkAbiParity(compiled: AbiEntry[]): number {
  const declared = new Set(
    (VERSEFLOW_ESCROW_ABI as unknown as AbiEntry[]).map(signature).filter(Boolean) as string[],
  );
  const actual = new Set(compiled.map(signature).filter(Boolean) as string[]);

  const missing = [...declared].filter((s) => !actual.has(s)).sort();
  if (missing.length > 0) {
    console.error("\nABI drift -- declared in src/lib/chain/abi.ts, absent from the contract:");
    for (const m of missing) console.error(`  ${m}`);
    console.error("\nThese calls would revert on chain. Reconcile abi.ts with the Solidity source.");
    throw new Error(`${missing.length} ABI entr(ies) have no counterpart in the contract.`);
  }
  return declared.size;
}

function main() {
  console.log(`solc ${solc.version().split("+")[0]}`);

  const { abi, bytecode, deployedSize, warnings } = compile();
  // Git does not preserve mtimes, so staleness is detected by content, not timestamp.
  const sourceHash = createHash("sha256").update(readFileSync(SOURCE)).digest("hex");
  console.log(`Compiled cleanly (${warnings} warning(s)).`);

  if (deployedSize > MAX_DEPLOYED_BYTES) {
    throw new Error(`Deployed size ${deployedSize} exceeds the EIP-170 limit of ${MAX_DEPLOYED_BYTES}.`);
  }
  const headroom = Math.round((1 - deployedSize / MAX_DEPLOYED_BYTES) * 100);
  console.log(`Deployed size ${deployedSize.toLocaleString()} bytes (${headroom}% under the EIP-170 limit).`);

  const checked = checkAbiParity(abi);
  console.log(`ABI parity OK -- all ${checked} entries the app declares exist in the contract.`);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    OUT_FILE,
    `${JSON.stringify(
      { contract: "VerseFlowEscrow", compiler: solc.version(), sourceHash, abi, bytecode },
      null,
      2,
    )}\n`,
  );
  console.log(`\nArtifact -> contracts/artifacts/VerseFlowEscrow.json`);
}

try {
  main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
