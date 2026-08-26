# Security

VerseFlow moves money, so the operating assumption is that frontend state is attacker
controlled and every financial decision must be re-derived server-side.

---

## Custody

**The server holds no private keys and has no signing path.**

Every state-changing chain operation is returned as an unsigned `PreparedTransaction` for
the user's own wallet to sign. The backend orchestrates; it does not custody.

The escrow contract has no operator withdrawal function and no upgrade hatch. Funds are
held by the contract, and the only paths out are:

| Path | Who can trigger it | Bound |
|---|---|---|
| `releaseMilestone` | The **client** only | ≤ that milestone's remaining balance |
| `settleDispute` | The **arbiter** only, and only on a flagged milestone | ≤ that milestone's remaining balance, split between the two parties |
| `cancelAndRefund` | The **provider**, or the arbiter during a dispute | Unreleased balance → client |

The arbiter cannot pay itself, cannot touch an undisputed milestone, and cannot reach funds
allocated to other milestones.

---

## Transaction verification

A wallet returning a transaction hash means the transaction was **broadcast**, not that it
succeeded. A payment is marked `confirmed` only after `verifyTransaction` returns a
successful receipt with the configured number of confirmations.

- A reverted receipt → `failed`, and the milestone is **not** credited.
- A missing receipt → `pending`, never `failed`. Treating an unconfirmed transaction as
  failed would be as wrong as treating it as settled.
- On confirmation, escrow state is cross-checked: if the on-chain total does not match the
  agreement value, the service raises `AMOUNT_MISMATCH` rather than proceeding.

`reconcile()` compares the payment ledger against the settlement layer and **reports**
divergence without correcting it. Silently "fixing" a mismatch would destroy the only
signal that something is wrong.

---

## Authorization

Checked server-side on every write, never inferred from the request body.

- The session address comes from an httpOnly cookie, never from a client-supplied field.
- `requireRole` and `assertNotSelfDealing` gate every payment action. A provider cannot
  approve their own milestone; a client cannot submit work on the provider's behalf; an
  agreement cannot have the same party on both sides.
- The state machine encodes permitted actors per transition, so authorization and state
  validity are checked together.
- Not being a party to an agreement returns **not found**, not forbidden — the existence of
  private agreements is never revealed by the difference.
- `generateMetadata` repeats the page's authorization check. Without it a private
  agreement's reference and title would leak through the document title while the page body
  stayed guarded.

---

## Financial invariants

Enforced independently of the UI:

| Invariant | Where |
|---|---|
| Milestone amounts equal the contract value | Builder UI, zod schema, `sendForSignature`, `prepareFunding` |
| A release never exceeds the milestone's remaining balance | `remainingFor()` from the confirmed ledger + in-flight payments |
| A milestone is never released twice | State machine (no transition out of `released`) + `ALREADY_RELEASED` |
| Partial releases require a stated reason | Schema + service |
| Revision rounds are capped at the agreed number | `requestRevision` |
| Evidence is required when the agreement says so | `submitMilestone` |
| Money is never a float | Integer minor units throughout; `BigInt` for chain conversion |

`remainingFor` deliberately subtracts **in-flight** payments as well as confirmed ones.
That is what stops two concurrent releases with different idempotency keys from together
exceeding the milestone.

An over-award in a dispute settlement is **rejected**, not silently clamped to the
remaining balance. Quietly reducing an amount would let a resolver believe they awarded
something they did not.

### Dispute settlement authority

Deliberately asymmetric, because the risks are:

| Outcome | Client | Provider | Operator |
|---|:--:|:--:|:--:|
| Release to the provider (full or partial) | ✓ | — | ✓ |
| Withdraw a dispute you opened | ✓ | ✓ | ✓ |
| Refund the full amount to the client | — | — | ✓ |

A client releasing to the provider is giving away money they could have released anyway. A
client refunding *themselves* takes money back from someone who may have delivered, so it
requires operations review. A provider can never award themselves, and neither party can
withdraw a dispute the other opened.

This is enforced in two independent places: the service checks the actor, and the state
machine gates `disputed → approved | partially_approved | cancelled` by role. While a
dispute is open, the ordinary release path refuses outright — including for an operator, so
there is no back door around the resolution flow.

---

## Idempotency and replay

Every payment operation takes a client-generated idempotency key, claimed **before any
validation**:

- A completed key always returns its original stored result.
- An in-flight key is refused with `DUPLICATE_REQUEST`.
- A failed validation releases the key so a corrected retry can reuse it.

`idempotency_keys.key` is a primary key, so the database rejects a concurrent duplicate
claim rather than relying on application-level checks.

Sign-in nonces are issued server-side into an httpOnly cookie and consumed on use, so a
signature cannot be replayed. The signed message states plainly that signing proves address
control and does not authorize any payment.

Signatures are bound to the exact terms hash. If the terms changed since a signature was
prepared, it is rejected rather than accepted against different terms.

---

## Immutable records

Migration `0002_audit_immutability` makes append-only a **database guarantee**:

```sql
CREATE FUNCTION vf_reject_confirmed_payment_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'confirmed' AND (
       NEW.amount <> OLD.amount
       OR NEW.recipient_address <> OLD.recipient_address
       OR COALESCE(NEW.tx_hash, '') <> COALESCE(OLD.tx_hash, '')
     ) THEN
    RAISE EXCEPTION 'confirmed payments cannot be altered';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_confirmed_immutable BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION vf_reject_confirmed_payment_change();
```

Plus `activity_events` (no update) and `audit_log` (no update, no delete). No service and
no operator tool can get around them — a test asserts the triggers actually fire.

Administrative dispute resolution creates **new** records and writes an audit event. It
never edits historical ones.

---

## Input handling

- Every write path parses its body with zod before anything touches the database.
- Money strings are parsed through `parseMoney`, which throws on malformed input instead of
  coercing to `0`.
- Free text is length-capped at the schema level; React escapes on render, and
  `sanitizeText` strips markup as defence in depth.
- External links carry `rel="noopener noreferrer nofollow"` and `target="_blank"`.

---

## Rate limiting

Fixed-window counters per user or IP, scoped per operation, with tighter limits on the
expensive and sensitive paths:

| Scope | Limit |
|---|---|
| `auth.verify` | 10 / min |
| `ai.generate` | 20 / 5 min |
| `escrow.fund`, `milestone.approve` | 15–30 / min |
| `dispute.open` | 10 / 5 min |
| `escrow.confirm`, `payment.confirm` | 120 / min (polling endpoints) |

---

## Headers

Set globally in `next.config.ts`: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and a
`Permissions-Policy` denying camera, microphone, and geolocation. Session cookies are
httpOnly, `sameSite: lax`, and `secure` in production.

---

## Secrets

No secret is exposed to the client. `ANTHROPIC_API_KEY`, `VERSE_ANALYTICS_API_KEY`,
`VERSE_RPC_URL`, and `VERSE_ESCROW_ADDRESS` are server-only; only `NEXT_PUBLIC_*` values —
chain id, name, explorer URL, settlement mode — reach the browser, and none of them are
sensitive.

`/api/demo/reset` wipes the database, so it is disabled in production unless
`ALLOW_DEMO_RESET=true` is explicitly set.

---

## Known limitations

Stated plainly rather than left for someone to discover:

- **Arbitration is operator-mediated, not decentralized.** A single arbiter address is set
  at deployment. Its powers are narrow and audited, but it is a trusted role.
- **Evidence metadata is self-reported.** Commit counts and deployment reachability are
  recorded as supplied by the provider. Verifying them through each provider's API is the
  next step; until then the analyzer treats them as claims, which is why it marks what it
  cannot confirm as `unverified`.
- **The demo personas use a marker signature.** That path is gated on simulated mode and
  named `simulated_signature` in the stored record, so it can never be mistaken for a real
  signature check. In live mode every signature is cryptographically verified.
- **The demo seed is public data by design.** A deployed demo lets anyone sign in as a
  seeded persona and move simulated funds. That is the point of a buildathon demo, but it
  is not an access-control model for real money.
- **The contract has not been through a third-party audit.**
