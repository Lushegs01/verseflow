# Demo walkthrough

A four-minute run through the complete payment lifecycle. No wallet, no API keys, no
external services.

```bash
npm install && npm run db:reset && npm run dev
```

---

## The seeded scenario

**VF-1042 — E-commerce Website Redesign**

| | |
|---|---|
| Client | Northstar Coffee, a specialty roaster with three cafes and a growing online store |
| Provider | Alex Morgan, full-stack developer |
| Value | **$3,000** across three milestones |

| Milestone | Amount | State |
|---|---|---|
| Design | $750 | **Released** — settled 24 days ago |
| Development | $1,500 | **Ready for review** — submitted 2 days ago with evidence |
| Launch | $750 | **Locked** — starts when Development settles |

Behind it sits two years of history for Alex: 23 completed agreements, ~$51.9K settled,
repeat clients, and one real dispute that was resolved by a negotiated split.

**Every reputation and analytics number is computed from that history at request time.**
None of it is written by the seed — which is the point. If the seed produced the numbers,
they would prove nothing.

---

## The main flow — client side (about 3 minutes)

Open `http://localhost:3000/api/demo/start?persona=client`

### 1. Dashboard
You land on **VF-1042**. Go to `/app` to see the dashboard first: it opens with what you
need to do, not with charts. "Milestone awaiting review — $1,500" sits at the top because
it is the thing with money attached.

### 2. The agreement workspace
`$3,000 secured · 1 / 3 milestones complete`. The sidebar payment timeline shows
`$750 Released · $1,500 Current · $750 Locked`, so money is visibly tied to work progress.

Scroll the **Agreement activity** trail at the bottom: funding, submission, evidence
hashing, analysis, approval, release — each timestamped, attributed, and carrying a
transaction hash where one exists.

### 3. Review the milestone → **the moment that matters**
Click **Review milestone · $1,500**.

Four evidence items, each hashed and timestamped: a GitHub repository (37 commits since the
milestone opened), a reachable staging deployment, responsive screenshots at three
breakpoints, and the provider's own notes.

Then the **AI Verification Assistant**:

```
Evidence consistency: High

✓ All agreed pages accessible and functional          Met
✓ Responsive at 390px, 768px and 1440px               Met
✓ No blocking defects in navigation or checkout       Likely met
✓ Staging URL reachable and current                   Met
✓ Source repository accessible to the client          Met
⚠ Verified in current Chrome, Safari, Firefox, Edge   Not verified

Recommendation:  Likely satisfies milestone      81% confidence
```

**Look closely at the last criterion.** Cross-browser testing cannot be confirmed from a
repo link and screenshots, so the analyzer marks it **unverified** rather than quietly
passing it — and confidence drops to 81% because of it. The provider flagged the same gap
in their own notes.

Underneath, where the decision is actually being formed:

> **AI recommendation — not a unilateral payment decision.** This analysis has no authority
> over escrow. What can happen next is determined by the agreement rules and by an
> authorized human decision.

### 4. Decide
Four full-weight actions: **Approve & release**, **Request revision**, **Release partial**,
**Open dispute**. The primary is visually dominant because it is usually right, but nothing
nudges you toward it.

Try **Release partial** first to see the mechanic: pick 60%, and the split renders *before*
anything executes — `$900 released / $600 remains locked`. A reason is mandatory. Cancel out.

Now **Approve & release $1,500**. Watch the real states: *Releasing payment → Confirming on
the simulated network → Payment released.* The payment is marked settled only after the
settlement layer confirms the receipt.

### 5. What changed
Back on the agreement: Development is **Paid**, Launch has **automatically activated**,
progress reads 75%, and the activity trail has three new entries.

---

## Provider side (about 1 minute)

`http://localhost:3000/api/demo/start?persona=provider` — or use **Switch to provider** in
the demo banner.

- **`/app`** — the same dashboard, inverted. Now it is *your* work that is due.
- **The agreement** — the payment you were just sent appears in the timeline.
- **`/app/reputation`** — 23 contracts, $51.9K settled, 95% on time, 97% milestone success,
  1 dispute, 83% repeat clients. All computed. Private by default; the privacy panel lets
  you publish metrics individually.
- **`/p/alexmorgan`** — the public profile a client would see. Showcased projects can hide
  their exact value behind a band (`$1K – $5K`).
- **Submit a milestone** — open Launch and try submitting. Required evidence kinds are
  highlighted, and the analysis runs on what you actually attach.

---

## Worth a look

**Create an agreement** → `/app/agreements/new` → **Describe your project**

Paste:

> I need a designer to create a brand identity for my startup. The total budget is $2,500.
> I want a moodboard first, then logo concepts, then final brand files. Two revision rounds.

You get three milestones with amounts summing exactly to $2,500, acceptance criteria,
evidence requirements, and two flagged issues to accept, edit, or reject. **Without an API
key this is the deterministic rule engine** — the UI says so. Try the second example brief
with an explicit schedule (`€750 after design, €1,500 after development…`) and it honours
those amounts exactly instead of imposing a template.

**Operations console** → `/api/demo/start?persona=operator` → `/app/admin`

The resolved dispute from Alex's history, the append-only audit log, per-agreement
reconciliation against the settlement layer, and an explicit statement of what operations
*cannot* do.

**Analytics** → `/app/analytics` — activation, funding conversion, completion rate,
milestone approval rate, dispute rate, the lifecycle funnel, and weekly volume.

**Command palette** — `⌘K` / `Ctrl+K`. Search agreements, milestones, payments, and
transaction hashes. Results are permission-filtered server-side.

**Mobile** — resize to 390px. Bottom navigation, a centred create action within thumb
reach, sticky submit bars, and stacked milestone cards. It is a different layout, not a
shrunken desktop.

**Dark mode** — the toggle in the header.

---

## Things to poke at

The claims in this product are testable. A few worth trying:

| Try this | What happens |
|---|---|
| Approve, then retry the same request | Idempotency returns the original payment. No double release. |
| Sign in as provider, try to approve your own milestone | `FORBIDDEN — Only the client on this agreement can do that.` |
| Open a URL for an agreement you are not party to | Not found. Not "forbidden" — the existence of private agreements is never revealed, including in the page title. |
| Edit a milestone amount so the total no longer matches | The allocation bar turns red and the agreement cannot be created. |
| Open a dispute | The milestone freezes. Neither party can release while it is open. |
| Reload anything | State persists. It is all in SQLite. |

Reset at any time with **Reset demo** in the banner, or `npm run db:reset`.

---

## What is simulated, and where it says so

Settlement runs on a local ledger that enforces the same invariants as
`contracts/VerseFlowEscrow.sol` — monotonic releases, per-milestone caps, client-only
authorization, terms-hash binding. Transactions confirm after a short delay so the UI
exercises its real pending → confirming → confirmed states.

This is labelled in the sidebar of every screen, in the agreement's settlement panel, on
the funding screen, next to every simulated transaction hash, and in the site footer.
**Simulated activity is never presented as live network activity.**

Point `VERSE_RPC_URL` and `VERSE_ESCROW_ADDRESS` at a deployed contract and the same code
paths run against the real network. No application logic changes.
