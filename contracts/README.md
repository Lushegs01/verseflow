# VerseFlowEscrow

Milestone escrow for programmable work agreements on Verse (EVM / OP Stack).

`VerseFlowEscrow.sol` is the contract the application settles against. It is deliberately
small and has no proxy, no upgrade path, and no operator withdrawal function.

---

## What it guarantees

| Guarantee | How |
|---|---|
| Funds are held by the contract, not by VerseFlow | No operator role exists; no function pays an operator |
| Only the client can release | `releaseMilestone` reverts with `NotClient()` for anyone else |
| A milestone can never over-pay | `released[i] <= amounts[i]`, checked on every release |
| Total releases never exceed the deposit | Follows from the per-milestone cap |
| Terms cannot be silently changed | `termsHash` stored at funding; `verifyTerms` re-checks it |
| Escrow is never underfunded | Creation and funding are atomic in `fundAgreement` |
| Fee-on-transfer tokens cannot under-fund | Balance-delta check around `transferFrom` |
| Reentrancy on payout | `nonReentrant` guard; effects before interactions |

---

## The arbiter

Set once in the constructor and immutable thereafter. Its powers are deliberately narrow:

- It can act **only** on a milestone a party has explicitly flagged via `flagDispute`.
- It can only split **that milestone's own remaining balance** between the two parties.
- It cannot touch other milestones, cannot change terms, and cannot pay itself.

This is operator-mediated arbitration. The product says so, in the dispute UI and in the
docs. It is not decentralized arbitration and is not described as such.

---

## Interface

```solidity
function fundAgreement(
    bytes32 agreementId,      // keccak256(termsHash, client, provider), computed off chain
    address provider,
    address token,            // ERC-20, or address(0) for the native coin
    uint256[] calldata amounts,
    bytes32 termsHash
) external payable;

function releaseMilestone(bytes32 agreementId, uint256 milestoneIndex, uint256 amount) external;
function anchorEvidence(bytes32 agreementId, uint256 milestoneIndex, uint256 round, bytes32 bundleHash) external;
function flagDispute(bytes32 agreementId, uint256 milestoneIndex) external;
function settleDispute(bytes32 agreementId, uint256 milestoneIndex, uint256 providerAmount) external;
function cancelAndRefund(bytes32 agreementId) external;
```

`agreementId` is derived rather than random, so the same terms between the same parties
always produce the same id — which makes funding naturally idempotent at the contract level.

Evidence is anchored **by hash only**. No work product goes on chain.

The full audit trail is reconstructable from events alone: `AgreementFunded`,
`MilestoneReleased`, `EvidenceAnchored`, `MilestoneDisputed`, `DisputeSettled`,
`AgreementCompleted`, `AgreementCancelled`.

---

## Deploying

The contract has no constructor dependencies beyond the arbiter address.

```bash
# with foundry
forge create contracts/VerseFlowEscrow.sol:VerseFlowEscrow \
  --rpc-url "$VERSE_RPC_URL" \
  --constructor-args "$ARBITER_ADDRESS" \
  --private-key "$DEPLOYER_KEY"
```

Then point the application at it — no application code changes:

```bash
NEXT_PUBLIC_SETTLEMENT_MODE=live
VERSE_RPC_URL=https://rpc.your-verse-endpoint
VERSE_ESCROW_ADDRESS=0x…
NEXT_PUBLIC_VERSE_CHAIN_ID=20197
NEXT_PUBLIC_VERSE_EXPLORER_URL=https://explorer…

# for ERC-20 settlement; leave blank to settle in the native coin
NEXT_PUBLIC_VERSE_USDC_ADDRESS=0x…
```

If either `VERSE_RPC_URL` or `VERSE_ESCROW_ADDRESS` is missing, the application stays in
simulated mode rather than reporting confirmations that did not happen.

### ERC-20 settlement

`fundAgreement` pulls tokens with `transferFrom`, so the client must `approve` the escrow
for the total first. `EvmVerseAdapter.prepareFunding` returns the escrow call; the approval
step is the wallet's standard ERC-20 flow.

---

## The ABI stays in sync

`src/lib/chain/abi.ts` declares the ABI as a typed `const`, so viem infers argument and
return types from it. A mismatch between that file and this Solidity source becomes a
**compile error** rather than a runtime revert.

---

## Not audited

This contract has not been through a third-party security audit. It is deliberately small
and free of upgrade mechanisms, but that is not a substitute for one.
