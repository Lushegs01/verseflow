# VerseFlow

**Turn agreements into programmable payments.**

VerseFlow is a programmable escrow and payment orchestration platform for freelancers,
agencies, creators, consultants, developers, and the clients who hire them. It takes an
ordinary work agreement —

> "Build me a 5-page website for €3,000. €750 after design, €1,500 after development,
> €750 after launch."

— and turns it into **Agreement → Escrow → Milestones → Evidence → Verification →
Payment → Reputation**.

Built for the **Verse Buildathon — Payments & Merchant Solutions**.

---

## Run it

Requires **Node 20+**. Nothing else — no database server, no API keys, no wallet.

```bash
npm install && npm run db:reset && npm run dev
```

Then open one of the demo personas:

| Persona | URL | What you see |
|---|---|---|
| **Client** (Northstar Coffee) | `http://localhost:3000/api/demo/start?persona=client` | A milestone waiting for your review, $1,500 ready to release |
| **Provider** (Alex Morgan) | `http://localhost:3000/api/demo/start?persona=provider` | 23 completed contracts, work in progress, a live reputation |
| **Operations** | `http://localhost:3000/api/demo/start?persona=operator` | The operations console, audit log, and dispute queue |

The demo signs you in as a real seeded account. Every action from there runs the real
services — it is a shortcut past wallet authentication, not a separate mock code path.

See [`docs/DEMO.md`](docs/DEMO.md) for a 4-minute guided walkthrough.

---

## The core idea

Existing payment systems sit *between* two people. They do not manage the agreement.
An invoice records what someone **says** happened. VerseFlow holds the money against what
the two sides actually agreed, and releases it when a person says the terms were met.

At any moment, both parties can answer the same six questions:

| | |
|---|---|
| **Agreement** | What did we promise? |
| **Escrow** | Where is the money? |
| **Evidence** | What happened? |
| **Decision** | Was the milestone satisfied? |
| **Settlement** | What gets paid? |
| **Reputation** | What happened over time? |

---

## The trust principle

> **VerseFlow does not let AI decide who receives money.**

AI helps structure agreements and analyze evidence. Payment actions remain governed by
explicit agreement rules and authorized human decisions. Four layers are kept visibly
separate throughout the product:

| Layer | Authority |
|---|---|
| **AI recommendation** | Structures terms, reads evidence against criteria. **Advisory only.** |
| **Contract rule** | What the parties agreed: amounts, windows, revision limits, evidence requirements. |
| **Human approval** | A person with the authority decides. The client releases; nobody releases for them. |
| **On-chain settlement** | The escrow contract executes only what an authorized party signed for. |

This is enforced in code, not just in copy:

- The AI layer has **no write access to escrow**. It cannot move a milestone between
  states, and nothing downstream branches on its output to decide whether money moves.
- The escrow contract accepts a release **only from the client's own key**.
- The evidence analyzer **never claims certainty** — criteria it cannot check from the
  submitted evidence are marked `unverified`, not quietly passed, and confidence is
  capped below 100 whenever anything is unverifiable.

---

## Architecture

```
src/
  app/                      Next.js App Router — marketing, app, API routes
  components/
    ui/                     Design system primitives
    app/                    Application components
    marketing/              Landing page
  lib/
    domain/                 Types, state machine, money, hashing, permissions ← no I/O
    db/                     Postgres, migrations, repositories                ← only place with SQL
    services/               Business logic (agreements, escrow, milestones, disputes…)
    chain/                  SettlementAdapter + simulated + live EVM adapters
    ai/                     Agreement engine + evidence analyzer
    api/                    Route plumbing, error mapping, rate limiting
contracts/
  VerseFlowEscrow.sol       The escrow contract
```

Four boundaries do the heavy lifting:

**`lib/domain`** is pure. No database, no network. Money is always an integer count of
minor units — floating point is never used for money. The state machine
(`domain/state-machine.ts`) is the single authority on what transitions are legal *and*
who may perform them, so validity and authorization are checked together rather than in
two places that can drift apart.

**`lib/db`** is the only code that knows SQL, and the only place that knows which
driver is in use.

**`lib/chain`** exposes a single `SettlementAdapter` interface. Services depend on it and
never on viem, an RPC client, or a wallet object — which is what makes the local
simulation and a live Verse deployment genuinely interchangeable.

**`lib/services`** holds business logic. Routes are thin: parse, authorize, delegate.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

---

## Settlement

VerseFlow settles on **Verse**, an EVM-compatible OP-Stack L2. Milestone escrow only works
when settlement is cheap enough to repeat and fast enough that nobody waits on a payment
they have already been told is coming — a three-milestone agreement is at least four
on-chain operations, and on a high-fee network the economics stop working for a $750
milestone.

### Two modes, and the product always says which

| Mode | When | Behaviour |
|---|---|---|
| `simulated` | Default; also when live config is incomplete | A deterministic local ledger enforcing the **same invariants** as the contract. Every receipt is stamped `simulated: true` and labelled in the UI. |
| `live` | `VERSE_RPC_URL` **and** `VERSE_ESCROW_ADDRESS` both set | Real transactions, real receipts, explorer links. |

If live mode is requested but misconfigured, VerseFlow **falls back to simulated and says
so** rather than reporting confirmations that did not happen. Simulated activity is never
presented as live network activity.

Going live is configuration, not a code change:

```bash
NEXT_PUBLIC_SETTLEMENT_MODE=live
VERSE_RPC_URL=https://rpc.your-verse-endpoint
VERSE_ESCROW_ADDRESS=0x…            # deployed VerseFlowEscrow
NEXT_PUBLIC_VERSE_CHAIN_ID=20197
NEXT_PUBLIC_VERSE_EXPLORER_URL=https://explorer…
```

---

## The escrow contract

[`contracts/VerseFlowEscrow.sol`](contracts/VerseFlowEscrow.sol) enforces four things the
application is **not** trusted to enforce on its own:

1. **Funds are held by the contract**, not by VerseFlow. There is no operator withdrawal
   path and no upgrade hatch.
2. **Only the client can release.** Neither the backend nor any AI component is an
   authorized party.
3. **Releases are monotonic and capped per milestone.** A milestone can never pay out more
   than it was funded for, and total releases can never exceed the deposit.
4. **The signed terms hash is stored on chain.** If the off-chain record is altered, the
   hashes stop matching and the discrepancy is visible to both parties.

Creation and funding are atomic — an agreement can never exist on chain in an underfunded
state, so a provider never sees a "funded" agreement that cannot actually pay. Evidence is
anchored **by hash only**; no work product goes on chain.

---

## The agreement engine

Natural language in, structured agreement out. Two engines:

- **With `ANTHROPIC_API_KEY`** — a language model does the extraction.
- **Without one** — a deterministic rule engine handles it: phase detection, budget
  parsing (`$3,000`, `2.5k`, `EUR 2.500`), explicit payment schedules
  (`750 after design, 1500 after development`), duration and revision-round extraction,
  and ambiguity flagging.

The rule engine is **not a degraded fallback**. It is why this repository can be cloned and
run end to end with no keys at all. The UI always states which engine produced a result.

Both paths run the same issue detector, which flags:

- milestone amounts that do not sum to the contract value *(blocking)*
- milestones with no acceptance criteria *(blocking)*
- ambiguous criteria — "make it professional", "works properly", "several concepts"
- missing deadlines, missing evidence requirements, front-loaded payment risk

Every suggestion is an explicit **accept / edit / reject** decision. Nothing is applied
silently.

---

## Testing

```bash
npm test          # 117 tests across 8 suites
npm run typecheck
npm run build
```

The suite covers what actually matters in a payments product:

- **State machine** — every valid transition, and an exhaustive sweep asserting that every
  *undeclared* pair is rejected for all four actor roles. A provider can never approve
  their own milestone; a client can never submit work; nobody but the system can mark a
  payment released.
- **Permissions** — the full viewer × action matrix. A provider cannot approve their own
  milestone, a client cannot submit on their behalf, an agreement cannot have one party on
  both sides, and a stranger gets `NOT_FOUND` rather than `FORBIDDEN` so the existence of
  private agreements is never leaked.
- **Money** — parsing, rounding half-up at display precision, and a property check that
  `splitEvenly` never loses or invents a minor unit across many totals and divisors.
- **Escrow** *(against a real in-memory database and the simulated adapter, not mocks)* —
  cannot release twice, cannot exceed the milestone, cannot fund unsigned agreements,
  partial releases settle to exactly the milestone amount, a failed payment never credits
  the milestone, and confirmed payments are rejected by a database trigger if altered.
- **Idempotency** — a replayed release key returns the original payment both before and
  after settlement; a *new* key on a settled milestone is refused; a failed validation
  releases the key so a corrected retry can proceed.
- **Disputes** — opening freezes the funds so neither party *nor an operator* can release
  outside the resolution path; a settlement cannot exceed the milestone balance; a provider
  cannot award themselves; a client cannot refund themselves in full unilaterally.
- **Reputation** — counts only *confirmed* payments, never approved-but-unconfirmed;
  publishes only the metrics a user opted into, metric by metric; and never publishes an
  agreement the user is not a party to.
- **Agreement engine** — every generated draft allocates exactly the contract value;
  explicit payment schedules in a brief are honoured verbatim; "two revision rounds" sets
  the allowance without inventing a QA milestone.

---

## Security

- **No private keys server-side.** Every state-changing chain call is returned as an
  unsigned transaction for the user's wallet. The backend orchestrates; it does not
  custody.
- **A wallet returning a hash is not proof.** A payment is marked confirmed only after the
  settlement layer returns a successful receipt with enough confirmations.
- **Idempotency on every payment operation.** A dropped response cannot cause a double
  release.
- **Append-only ledger, enforced by database triggers** — not by convention. Confirmed
  payments reject any change to amount, recipient, or transaction hash, including from an
  operator.
- **Authorization is re-checked server-side** on every write, including in
  `generateMetadata` — a private agreement's title must not leak through a page title.
- **Not-found and forbidden are indistinguishable** for agreements, so the existence of a
  private agreement is never revealed.

See [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Disputes — stated honestly

VerseFlow does **not** have a decentralized arbitration layer, and does not claim one.

The escrow contract has a single `arbiter` address set at deployment. It can act only on a
milestone a party explicitly flagged, can only split *that milestone's own balance* between
the two parties, cannot touch other milestones, and cannot pay itself. Every resolution
writes an immutable audit event visible to both sides. The UI says exactly this, where the
dispute is being resolved.

Who may settle what is deliberately asymmetric, because the risks are asymmetric:

| Outcome | Client | Provider | Operator |
|---|:--:|:--:|:--:|
| Release to the provider (full or partial) | ✓ | — | ✓ |
| Withdraw a dispute you opened | ✓ | ✓ | ✓ |
| Refund the full amount to the client | — | — | ✓ |

A client releasing to the provider is giving away money they could have released anyway, so
it needs no operator. A client refunding *themselves* takes money back from someone who may
have delivered — that requires operations review. A provider can never award themselves.

---

## Verse App Analytics

Product events are recorded locally and forwarded to Verse App Analytics when configured:

```bash
VERSE_ANALYTICS_ENDPOINT=…
VERSE_ANALYTICS_APP_ID=…
VERSE_ANALYTICS_API_KEY=…
```

Forwarding is fire-and-forget — analytics can never fail a payment. Without the
configuration, events still drive the internal analytics console at `/app/analytics`, which
computes activation, funding conversion, completion rate, dispute rate, payment volume, and
time-to-settlement **at request time from the agreement and payment tables**. Nothing is
pre-aggregated, so a number there cannot be inflated without the underlying escrow activity
actually existing.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Vitest suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:reset` | Wipe and re-seed the demo environment |
| `npm run db:migrate` | Show applied migrations |

## Environment

Every variable is optional — see [`.env.example`](.env.example). With none of them set, the
app runs against the local settlement simulation and the deterministic agreement engine,
which is the intended zero-setup path.
