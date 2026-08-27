# Deploying to Vercel

> **Live:** https://verseflow-five.vercel.app
> Vercel project `worldwide1/verseflow`, Neon Postgres via the Vercel Marketplace.

VerseFlow runs on Vercel with a managed Postgres. This takes about ten minutes.

---

## Why Postgres is required

The application writes to a database on every meaningful action. Vercel's
filesystem is read-only apart from `/tmp`, and each invocation can land on a fresh
container — so a file-backed database would appear to work and then silently lose
a funded escrow between requests. That is the worst possible failure for a
payments product, so production requires a real database.

Locally, with no `DATABASE_URL`, the app runs **PGlite** — Postgres compiled to
WASM, in-process. Same SQL, same plpgsql triggers, same transaction semantics.
`git clone && npm test` still needs no database server, and what runs locally is
genuinely the same dialect as production.

```
DATABASE_URL set    -> pg          -> managed Postgres   (production)
DATABASE_URL unset  -> PGlite      -> embedded, in-process (local, CI)
```

---

## 1. Create a database

Any Postgres works. Two easy options:

**Neon via the Vercel Marketplace** — Vercel retired its first-party Postgres, and
Neon is the successor; "Vercel Postgres" now means this. Provision it with:

```bash
vercel integration add neon
```

That injects `DATABASE_URL` into every environment, already pointing at the
**pooled** endpoint. Accepting Neon's terms needs a one-time browser step, which
the CLI prints a link for.

**Any other Postgres** — create it and copy the **pooled** connection string
(the host contains `-pooler`).

> Use the **pooled** string. Each serverless instance opens its own connection, and
> a direct connection string will exhaust the server's connection limit under load.
> `DATABASE_POOL_MAX` defaults to 1 for the same reason.

---

## 2. Deploy

```bash
npm i -g vercel
vercel login
vercel --prod
```

Or import the GitHub repository at vercel.com/new — pushes to `main` then deploy
automatically.

---

## 3. Set environment variables

In the Vercel dashboard under Settings → Environment Variables, or with
`vercel env add`:

| Variable | Value | Required |
|---|---|---|
| `DATABASE_URL` | Pooled Postgres connection string | **Yes** (auto-set by Vercel Postgres) |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` | Recommended |
| `ALLOW_DEMO_RESET` | `true` to let judges reset the demo | Optional |
| `ANTHROPIC_API_KEY` | Enables the model-backed agreement engine | Optional |
| `NEXT_PUBLIC_SETTLEMENT_MODE` | `live` to settle on a real network | Optional |
| `VERSE_RPC_URL` | Verse RPC endpoint | Only for `live` |
| `VERSE_ESCROW_ADDRESS` | Deployed `VerseFlowEscrow` address | Only for `live` |

Everything except `DATABASE_URL` has a working default. With no
`ANTHROPIC_API_KEY` the deterministic rule engine runs and the UI says so; with no
Verse settlement configured the app stays in simulated mode and labels itself
accordingly rather than reporting confirmations that did not happen.

Redeploy after adding variables — Vercel does not apply them to existing builds.

---

## 4. Migrate and seed

Migrations apply automatically on the first database connection, so a deployed
app migrates itself. Seeding the demo data is a separate, deliberate step.

**Option A — from your machine (recommended).** Reliable, and not subject to
function timeouts:

```bash
DATABASE_URL="postgres://..." npm run db:seed
```

**Option B — from the deployed app.** Visiting any demo persona seeds an empty
database on first request:

```
https://your-app.vercel.app/api/demo/start?persona=client
```

The seed writes ~24 agreements and can take 20–40 seconds. `vercel.json` raises
that route to a 60-second limit, but Option A avoids the risk entirely.

To rebuild the demo later, either run `npm run db:reset` against `DATABASE_URL`,
or set `ALLOW_DEMO_RESET=true` and use the **Reset demo** button in the banner.

---

## 5. Check it worked

```
https://your-app.vercel.app/                                  landing page
https://your-app.vercel.app/api/demo/start?persona=client     signs in, seeds if empty
https://your-app.vercel.app/api/demo/start?persona=provider
https://your-app.vercel.app/api/demo/start?persona=operator
```

The client persona should land on **VF-1042** with a Development milestone ready
for review and $1,500 available. If reputation on `/app/reputation` reads 23
contracts and ~$51.9K settled, the seed and the computed metrics are both working.

---

## Going live on Verse

Deploy the escrow contract, then set three variables — no application code
changes:

```bash
NEXT_PUBLIC_SETTLEMENT_MODE=live
VERSE_RPC_URL=https://rpc.your-verse-endpoint
VERSE_ESCROW_ADDRESS=0x…
```

See [`contracts/README.md`](../contracts/README.md) for deployment. If either the
RPC URL or the escrow address is missing, the app stays simulated deliberately
rather than pretending to be on a network.

---

## Notes and gotchas

**Bundle size.** `@electric-sql/pglite` ships a ~3 MB WASM binary. It is a runtime
`import()` that never executes when `DATABASE_URL` is set, but it does travel in
the deployment. Move it to `devDependencies` if you want it out — at the cost of
a confusing failure if someone deploys without a database configured.

**Externals.** `pg` and `@electric-sql/pglite` are listed in
`serverExternalPackages` in `next.config.ts`. PGlite ships its own Node filesystem
shim, and bundling rewrites the module paths so the shim receives a `URL` where it
expects a string. Do not remove them from that list.

**Connection limits.** If you see `too many connections`, you are almost certainly
using a direct connection string instead of a pooled one.

**Cold starts.** The first request after a deploy runs migrations. It is a couple
of hundred milliseconds against an already-migrated database, and only the very
first request pays the full cost.
