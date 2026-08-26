# Architecture

## Layering

```
  UI (app/, components/)
        │  thin: parse → authorize → delegate
        ▼
  Services (lib/services/)          business logic, transactions, audit
        │
        ├──────────────┬──────────────┬─────────────────┐
        ▼              ▼              ▼                 ▼
  Domain          Repositories    Settlement        Agreement
  (lib/domain/)   (lib/db/)       (lib/chain/)      engine (lib/ai/)
  pure, no I/O    only SQL        only chain code   advisory only
```

Four rules hold this together:

1. **`lib/domain` is pure.** No database, no network, no framework. It can be reasoned
   about and tested in isolation, which is why the state machine and money handling live
   there.
2. **`lib/db` is the only code that writes SQL.** Services work with domain objects and
   never see a row shape.
3. **`lib/chain` is the only code that knows about blockchains.** Services depend on the
   `SettlementAdapter` interface, never on viem or a wallet object.
4. **`lib/ai` has no write access to anything.** It returns data structures. Services
   decide what to do with them, and none of them branch on AI output to move money.

---

## The state machine

`lib/domain/state-machine.ts` is the single authority on what transitions are legal. Every
transition declares both `from → to` *and* which actors may trigger it:

```ts
{
  from: "under_review",
  to: "approved",
  action: "approve",
  actors: ["client"],          // ← not "provider", not "system"
  description: "The client approved the milestone in full.",
}
```

Declaring the actor alongside the transition means validity and authorization are checked
in one place rather than in two that can drift apart. `assertMilestoneTransition` throws
`InvalidTransitionError` for an undeclared pair and `UnauthorizedTransitionError` for a
declared pair the actor may not perform — and the API layer maps each to a distinct
machine-readable error code.

Some consequences that fall out of the table:

- `approved → released` is a **`system`** transition. No party can mark a payment released;
  only confirmed settlement does that.
- `under_review → approved` excludes `provider`, so a provider can never approve their own
  work.
- `in_progress → submitted` excludes `client`, so a client cannot submit on the provider's
  behalf.
- Nothing transitions **out of** `released` or `cancelled`. The test suite asserts this
  exhaustively rather than trusting the table to stay correct.

The `awaitsClient` / `awaitsProvider` helpers drive the dashboard action queue from the
same source of truth, so what the UI says is pending can never disagree with what the
service will accept.

---

## Money

Every monetary value is an **integer count of minor units**. Floating point is never used
for money, anywhere.

`lib/domain/money.ts` provides:

- `parseMoney` — tolerant of `$1,500.50`, `EUR 2.500`, `3k`; rounds **half-up** at display
  precision; throws rather than silently returning `0` on bad input.
- `splitEvenly` — distributes a remainder to the earliest parts so a split never loses or
  invents a minor unit. Property-tested across many totals and divisors.
- `toChainUnits` / `fromChainUnits` — scale between display precision (2dp) and on-chain
  decimals (6 for USDC, 18 for native) using `BigInt`, never `Number`.

The **allocation invariant** — milestone amounts must equal the contract value — is
enforced in four places: live in the builder UI, in the zod schema, again in
`sendForSignature`, and once more in `prepareFunding` immediately before money moves.

---

## Hashing and the agreement lock

`lib/domain/hashing.ts` produces the value both parties sign:

```
canonicalTerms(agreement, milestones, parties)   → deterministic, key-sorted JSON
  → keccak256                                    → termsHash
  → keccak256(termsHash | client | provider)     → onChainId
```

Canonicalization sorts object keys recursively, because `JSON.stringify` preserves
insertion order and that is not stable across code paths. Anything financially meaningful
must be inside `canonicalTerms` — a field that is not in the preimage can be changed
without changing the hash.

`onChainId` is derived rather than random, so the same terms between the same parties
always produce the same escrow id. That makes funding naturally idempotent at the contract
level, not just the application level.

At funding time the service **recomputes** the hash rather than trusting the stored one. If
they differ, the stored terms were altered after signing and funding is refused.

Hashing uses viem's isomorphic primitives, not `node:crypto`, so the module is safe to
import from client components — the display helpers (`shortHash`, `shortAddress`) are used
throughout the UI.

---

## The settlement boundary

```ts
interface SettlementAdapter {
  readonly mode: "simulated" | "live";
  prepareFunding(params):          Promise<PreparedTransaction>;
  prepareRelease(params):          Promise<PreparedTransaction>;
  prepareEvidenceAnchor(params):   Promise<PreparedTransaction>;
  prepareDisputeSettlement(params):Promise<PreparedTransaction>;
  verifyTransaction(txHash):       Promise<TxReceipt>;
  readAgreement(onChainId):        Promise<OnChainAgreementState | null>;
  verifyTerms(id, expectedHash):   Promise<boolean>;
}
```

Two properties matter:

**The server never signs.** Every state-changing call returns an *unsigned*
`PreparedTransaction` for the user's wallet. In simulated mode the adapter can execute
immediately (there is no wallet), and it returns a receipt stamped `simulated: true`.

**`verifyTransaction` is the only thing that can confirm a payment.** A wallet returning a
hash means the transaction was broadcast, not that it succeeded. A missing receipt is
reported as `pending`, never `failed` — treating an unconfirmed transaction as failed would
be as wrong as treating it as settled.

### The simulated adapter

Not a pretend blockchain. A deterministic ledger enforcing the *same* invariants as the
Solidity contract: monotonic releases, per-milestone caps, client-only authorization,
terms-hash binding. Behaviour observed in simulation matches behaviour on chain.

Confirmation is time-based rather than instant, so the UI exercises its real
pending → confirming → confirmed states instead of skipping to done.

`hydrateSimulatedEscrowFromDb()` runs on entry to the app layout, rebuilding escrow state
from the database after a server restart — without it, a reload would show a funded
agreement whose escrow had vanished from memory.

### Mode selection

`live` requires an RPC endpoint **and** a deployed escrow address. If either is missing,
the app stays `simulated` rather than pretending to be on a network. If live mode is
configured but the adapter fails to construct, it logs and falls back — the mode reported
to the UI becomes `simulated`, so every surface labels itself accordingly.

---

## The database layer

One dialect, two drivers, chosen by whether `DATABASE_URL` is set:

| | Driver | Where |
|---|---|---|
| `DATABASE_URL` set | `pg` | Production (Vercel + managed Postgres) |
| unset | PGlite | Local development, CI, tests |

PGlite is Postgres compiled to WASM running in-process — not a different database.
The same SQL, the same plpgsql triggers, the same transaction semantics. That keeps
`git clone && npm test` working with no database server while giving production real
dialect parity, which a SQLite-for-dev split could not.

### Transactions and AsyncLocalStorage

Repositories take an optional `Executor`. When none is passed they consult the
transaction currently in scope before falling back to the pool:

```ts
async function exec(db?: Executor): Promise<Executor> {
  return db ?? currentTransaction() ?? (await getDb());
}
```

`transaction()` pins a connection and runs the callback inside an
`AsyncLocalStorage` context holding that connection. Any repository call made
anywhere inside — including from a helper several frames deep that never received a
handle — automatically joins the transaction.

This matters more than it looks. Without it, `pg` would hand those calls a
*different* pooled connection: they would commit independently, and a rollback would
leave them behind. The failure is invisible locally, because PGlite has a single
connection and behaves correctly either way. Threading a handle through every call
site would also work, but it is 200+ call sites of opportunity to forget one.

Nested `transaction()` calls join the outer transaction rather than opening a second
one, so a service composing two transactional helpers still commits atomically.

### Multi-statement DDL

`Executor` exposes `exec(sql)` alongside `query(sql, params)`. A parameterized
statement can only ever carry one command, so migrations — which are multi-statement
DDL scripts — go down the `exec` path. Everything else uses parameters, always.

---

## Data model

| Entity | Notes |
|---|---|
| `User` | Wallet-derived. `publicProfileEnabled` + `publicMetrics` gate everything public. |
| `Agreement` | Carries `rules` as an immutable snapshot, plus `agreementHash` / `onChainId` after lock. |
| `Milestone` | `releasedAmount` is a **cached projection**; the payment ledger is authoritative. |
| `Evidence` | Hashed individually; bundle hash anchored on submission. |
| `EvidenceAnalysis` | Advisory. Records which `engine` produced it. |
| `Payment` | Immutable once confirmed. Unique `idempotencyKey`. |
| `Dispute` | Records who resolved it and the reasoning. |
| `ActivityEvent` | Append-only. The audit trail users read. |
| `AuditLogEntry` | Append-only. The record operations cannot rewrite. |

### Ledger authority

`remainingFor(milestone)` computes the releasable balance from **confirmed payments plus
anything in flight**, not from `milestone.releasedAmount`:

```ts
const confirmed = paymentsRepo.confirmedTotalForMilestone(milestone.id);
const pending   = /* payments in pending | submitted */;
return Math.max(0, milestone.amount - confirmed - pending);
```

Counting in-flight payments is what prevents two concurrent releases with different
idempotency keys from together exceeding the milestone. A test covers exactly that.

### Immutability as a database guarantee

Migration `0002_audit_immutability` installs plpgsql triggers so append-only is enforced
by the database, not by convention:

- `payments` cannot be deleted
- confirmed payments reject any change to `amount`, `recipient_address`, or `tx_hash`
- `activity_events` cannot be updated
- `audit_log` cannot be updated or deleted

No service, and no operator tool, can get around these. The only code that drops them is
`clearAllData()` in the demo seed — which throws the whole dataset away rather than editing
records, and reinstates the triggers in a `finally` block.

---

## Idempotency

Payment operations claim an idempotency key **before any validation**:

```
claim(key) ──→ duplicate  ──→ return the stored result
           ──→ in_flight  ──→ DUPLICATE_REQUEST
           ──→ claimed    ──→ validate → prepare → transaction → complete(key, result)
                                    │
                                    └─ on any error: release(key)
```

Claiming first is deliberate. A retry after a dropped response must return the original
result — it must not be re-validated against a balance the first attempt already spent, and
must not report "already paid out" for a payment the caller never saw succeed. Releasing
the key on failure means a corrected retry can reuse it.

---

## The agreement engine

**Extraction** — model path when `ANTHROPIC_API_KEY` is set, deterministic rule engine
otherwise. The rule engine matches phase vocabulary (discovery, moodboard, design, content,
development, QA, launch), parses budgets and explicit payment schedules, extracts durations
and revision counts, and distributes value by phase weight.

An explicit schedule in the brief (`750 after design, 1500 after development`) is honoured
directly — but only if the parts sum to within 2% of the stated total. If they do not, the
user gets an amount-mismatch issue instead of a silently wrong split.

**Issue detection** runs over the final draft regardless of which engine produced it, so
the same guarantees hold either way. Blocking issues (amounts not summing, missing
acceptance criteria) prevent funding; the rest are advisory.

**Evidence analysis** maps criterion keywords to the evidence kinds that can actually
substantiate them. A criterion mentioning a repository is not satisfied by a screenshot.
Criteria whose only signal has *no* verifiable evidence kind — cross-browser compatibility,
accessibility audits, subjective quality — are reported `unverified`, never assumed.
Confidence reflects coverage, is penalised for missing required evidence, and is capped
below 100 whenever anything is unverifiable.

Model output is **merged onto** the deterministic findings rather than replacing them, so a
criterion the model omitted keeps its rule-based assessment instead of silently
disappearing.

---

## API layer

Every route goes through `route()` in `lib/api/handler.ts`, which provides consistent
error mapping, rate limiting, and auth narrowing:

```ts
export const POST = route(
  { auth: true, rateLimit: { limit: 30, windowSeconds: 60, scope: "milestone.approve" } },
  async ({ request, auth, ip }) => { … },   // auth is non-null here, by types
);
```

Errors carry a stable `code` the UI branches on and a `message` written for a person.
Unexpected exceptions are logged server-side in full and returned as a generic `INTERNAL` —
internal exception text never reaches a caller.

Bodies are parsed with zod. `parseBody` is generic over the *schema* rather than a result
type, because schemas using `.default()` have different input and output types.

---

## Reputation and privacy

Reputation is computed at request time from settled contract history. Nothing is written by
a seed or a batch job — if the seed produced the numbers, they would prove nothing.

Settled value counts **confirmed payments only**; approved-but-unconfirmed money has not
actually moved and must not inflate a reputation number.

Privacy is layered:

- A public profile is opt-in, and each metric is published individually.
- Showcased agreements can hide their value behind a band (`$1K – $5K`).
- Counterparty identities, acceptance criteria, evidence, messages, and dispute details are
  never published.
- A profile that has not opted in returns **404**, not "this user is private" — the absence
  of a public profile is itself private information.
- Search results are filtered server-side to what the viewer owns or what is public.
- `generateMetadata` repeats the page's authorization check, so a private agreement's title
  cannot leak through the document title.
