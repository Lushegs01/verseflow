/**
 * ABI for VerseFlowEscrow (contracts/VerseFlowEscrow.sol).
 *
 * Kept as a typed const so viem infers argument and return types, which means a
 * mismatch between this file and the Solidity source is a compile error rather
 * than a runtime revert.
 */

export const VERSEFLOW_ESCROW_ABI = [
  {
    type: "function",
    name: "fundAgreement",
    stateMutability: "payable",
    inputs: [
      { name: "agreementId", type: "bytes32" },
      { name: "provider", type: "address" },
      { name: "token", type: "address" },
      { name: "amounts", type: "uint256[]" },
      { name: "termsHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "releaseMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agreementId", type: "bytes32" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "anchorEvidence",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agreementId", type: "bytes32" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "round", type: "uint256" },
      { name: "bundleHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "flagDispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agreementId", type: "bytes32" },
      { name: "milestoneIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleDispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agreementId", type: "bytes32" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "providerAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelAndRefund",
    stateMutability: "nonpayable",
    inputs: [{ name: "agreementId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getAgreement",
    stateMutability: "view",
    inputs: [{ name: "agreementId", type: "bytes32" }],
    outputs: [
      { name: "client", type: "address" },
      { name: "provider", type: "address" },
      { name: "token", type: "address" },
      { name: "totalAmount", type: "uint256" },
      { name: "totalReleased", type: "uint256" },
      { name: "termsHash", type: "bytes32" },
      { name: "createdAt", type: "uint64" },
      { name: "state", type: "uint8" },
      { name: "disputed", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getMilestones",
    stateMutability: "view",
    inputs: [{ name: "agreementId", type: "bytes32" }],
    outputs: [
      { name: "amounts", type: "uint256[]" },
      { name: "released", type: "uint256[]" },
    ],
  },
  {
    type: "function",
    name: "verifyTerms",
    stateMutability: "view",
    inputs: [
      { name: "agreementId", type: "bytes32" },
      { name: "expectedTermsHash", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "AgreementFunded",
    inputs: [
      { name: "agreementId", type: "bytes32", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "provider", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "termsHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MilestoneReleased",
    inputs: [
      { name: "agreementId", type: "bytes32", indexed: true },
      { name: "milestoneIndex", type: "uint256", indexed: true },
      { name: "provider", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "isPartial", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EvidenceAnchored",
    inputs: [
      { name: "agreementId", type: "bytes32", indexed: true },
      { name: "milestoneIndex", type: "uint256", indexed: true },
      { name: "round", type: "uint256", indexed: false },
      { name: "bundleHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

/** Minimal ERC-20 surface needed for the approve-then-fund flow. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
