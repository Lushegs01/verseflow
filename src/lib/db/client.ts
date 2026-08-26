/**
 * Database client.
 *
 * One dialect (Postgres), two drivers:
 *
 *   DATABASE_URL set    -> `pg` against a real Postgres (production, Vercel)
 *   DATABASE_URL unset  -> PGlite, embedded Postgres running in-process
 *
 * PGlite is not a different database -- it is Postgres compiled to WASM, running
 * the same SQL, the same plpgsql triggers, and the same transaction semantics.
 * That keeps `git clone && npm test` working with no database server while giving
 * production genuine dialect parity, which a SQLite-for-dev split would not.
 *
 * Everything above this module works with domain objects and never sees a row, so
 * swapping drivers again means changing this file and nothing else.
 */

import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations";

export interface QueryResult<T = Row> {
  rows: T[];
  rowCount: number;
}

export type Row = Record<string, any>;

/**
 * The narrow surface repositories depend on. A pooled connection and an open
 * transaction both satisfy it, which is what lets every repository method accept
 * an optional executor and participate in a caller's transaction.
 */
export interface Executor {
  query<T = Row>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  /**
   * Run multi-statement SQL. Migrations need this: a parameterized statement can
   * only ever carry one command, so DDL scripts have to go down a separate path.
   */
  exec(sql: string): Promise<void>;
}

let pool: Pool | null = null;
let pglite: PGlite | null = null;
let ready: Promise<Executor> | null = null;

function isProductionDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

// ---------------------------------------------------------------------------
// Driver construction
// ---------------------------------------------------------------------------

async function createPostgres(): Promise<Executor> {
  const { Pool } = await import("pg");

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Serverless functions are short-lived and numerous, so each instance holds
    // a single connection and leans on the provider's pooler for fan-in. Point
    // DATABASE_URL at a POOLED connection string (Neon/Supabase pooler).
    max: Number(process.env.DATABASE_POOL_MAX ?? 1),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: process.env.DATABASE_SSL === "disable" ? undefined : { rejectUnauthorized: false },
  });

  pool.on("error", (error) => {
    // An idle client erroring must not take the process down.
    console.error("[verseflow:db] idle client error", error);
  });

  return {
    async query<T = Row>(text: string, params: unknown[] = []) {
      const result = await pool!.query(text, params as never[]);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    },
    async exec(sql: string) {
      // Without parameters, node-postgres uses the simple query protocol, which
      // accepts multiple statements in one round trip.
      await pool!.query(sql);
    },
  };
}

async function createPglite(): Promise<Executor> {
  const { PGlite } = await import("@electric-sql/pglite");

  // PGlite persists into a DIRECTORY, not a single file. `:memory:` (or a test
  // run) gets an ephemeral instance so suites stay isolated; otherwise the data
  // directory survives restarts the way a local dev database should.
  const configured = process.env.VERSEFLOW_DATA_DIR ?? process.env.VERSEFLOW_DB_PATH;
  const ephemeral = configured === ":memory:" || process.env.NODE_ENV === "test";

  let dataDir: string | undefined;
  if (!ephemeral) {
    // A path ending in .db is a leftover from the SQLite era; treat its parent as
    // the data directory rather than creating a confusingly-named folder.
    const resolved = configured
      ? configured.endsWith(".db")
        ? path.join(path.dirname(configured), "pgdata")
        : configured
      : path.join(process.cwd(), "data", "pgdata");

    // PGlite does not create intermediate directories itself.
    mkdirSync(resolved, { recursive: true });
    dataDir = resolved;
  }

  pglite = await PGlite.create(dataDir);

  return {
    async query<T = Row>(text: string, params: unknown[] = []) {
      const result = await pglite!.query<T>(text, params as never[]);
      return { rows: result.rows, rowCount: result.rows.length };
    },
    async exec(sql: string) {
      await pglite!.exec(sql);
    },
  };
}

/**
 * The shared executor, created once per process and migrated on first use.
 * Concurrent callers await the same promise, so migrations never race.
 */
export function getDb(): Promise<Executor> {
  if (!ready) {
    ready = (async () => {
      const executor = isProductionDatabase() ? await createPostgres() : await createPglite();
      await runMigrations(executor);
      return executor;
    })().catch((error) => {
      // A failed init must not be cached, or every later request inherits it.
      ready = null;
      throw error;
    });
  }
  return ready;
}

/** Test helper: a fresh, isolated in-memory database with the schema applied. */
export async function createTestDb(): Promise<Executor> {
  const { PGlite } = await import("@electric-sql/pglite");
  const instance = await PGlite.create();
  const executor: Executor = {
    async query<T = Row>(text: string, params: unknown[] = []) {
      const result = await instance.query<T>(text, params as never[]);
      return { rows: result.rows, rowCount: result.rows.length };
    },
    async exec(sql: string) {
      await instance.exec(sql);
    },
  };
  await runMigrations(executor);
  return executor;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
  if (pglite) {
    await pglite.close().catch(() => {});
    pglite = null;
  }
  ready = null;
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

export async function runMigrations(target: Executor): Promise<void> {
  await target.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await target.query<{ name: string }>("SELECT name FROM _migrations")).rows.map((r) => r.name),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;

    // Each migration is atomic: Postgres supports transactional DDL, so a failure
    // leaves no half-applied schema behind.
    await target.query("BEGIN");
    try {
      await target.exec(migration.up);
      await target.query("INSERT INTO _migrations (name) VALUES ($1)", [migration.name]);
      await target.query("COMMIT");
    } catch (error) {
      await target.query("ROLLBACK").catch(() => {});
      throw new Error(
        `Migration "${migration.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * The executor for the transaction currently in scope, if any.
 *
 * Repositories consult this before falling back to the pool, which means a call
 * made anywhere inside `transaction()` automatically joins that transaction --
 * including from a helper several frames deep that never received a handle.
 *
 * Without it, `pg` would hand those calls a *different* pooled connection, so
 * they would commit independently and a rollback would leave them behind. That
 * failure is invisible in local development, because PGlite has only one
 * connection and appears to work correctly either way.
 */
const txContext = new AsyncLocalStorage<Executor>();

/** The active transaction executor, or undefined outside a transaction. */
export function currentTransaction(): Executor | undefined {
  return txContext.getStore();
}

/**
 * Run `fn` inside a transaction.
 *
 * Financial operations that touch more than one table (release payment + update
 * milestone + write activity) must use this, so a partial write can never leave
 * the ledger inconsistent.
 *
 * Nested calls join the outer transaction rather than opening a second one, so a
 * service composing two transactional helpers still commits atomically.
 */
export async function transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
  const existing = txContext.getStore();
  if (existing) return fn(existing);

  await getDb();

  if (pool) {
    // The whole transaction is pinned to one connection. Issuing BEGIN on a pool
    // without pinning would let statements land on different connections and
    // silently defeat the transaction.
    const client = await pool.connect();
    const tx: Executor = {
      async query<R = Row>(text: string, params: unknown[] = []) {
        const result = await client.query(text, params as never[]);
        return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
      },
      async exec(sql: string) {
        await client.query(sql);
      },
    };

    try {
      await client.query("BEGIN");
      const result = await txContext.run(tx, () => fn(tx));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // PGlite is single-connection, so a plain BEGIN/COMMIT is already pinned.
  const db = await getDb();
  await db.query("BEGIN");
  try {
    const result = await txContext.run(db, () => fn(db));
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------

/**
 * JSON columns are stored as TEXT so the mappers stay driver-agnostic, but a
 * driver may still hand back an already-parsed value. Both are accepted.
 */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

export function fromBool(value: boolean): boolean {
  return value;
}

/** Postgres returns TIMESTAMPTZ as a Date; the domain uses ISO strings. */
export function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Counts come back as strings from `pg` for bigint-ish results. */
export function toInt(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
