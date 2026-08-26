/**
 * Database client.
 *
 * Uses `node:sqlite`, which ships with Node 22.5+, so a clean checkout needs no
 * native build step and no external database -- important for a buildathon judge
 * running this for the first time.
 *
 * Everything goes through this module, and the repositories above it expose a
 * narrow interface, so swapping SQLite for Postgres means reimplementing
 * `src/lib/db/*` and nothing else.
 */

/**
 * `node:sqlite` ships with Node 22.5+, but bundlers do not all recognise it yet:
 *   - webpack (Next) needs it declared as an external, see `next.config.ts`
 *   - Vite (vitest) needs the resolver plugin in `vitest.config.ts`
 *
 * With those two lines of configuration in place, a plain static import is the
 * correct form here -- earlier attempts to load it dynamically were silently
 * tree-shaken to `undefined` in the production build.
 */
import { DatabaseSync as SqliteDatabase, type DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations";

let db: DatabaseSync | null = null;

function resolveDbPath(): string {
  const configured = process.env.VERSEFLOW_DB_PATH;
  if (configured === ":memory:") return ":memory:";
  const file = configured ?? path.join(process.cwd(), "data", "verseflow.db");
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

export function getDb(): DatabaseSync {
  if (db) return db;
  const file = resolveDbPath();
  db = new SqliteDatabase(file);
  // WAL keeps reads from blocking writes; foreign keys are off by default in SQLite.
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return db;
}

/** Test helper: a fresh in-memory database with the schema applied. */
export function createTestDb(): DatabaseSync {
  const test = new SqliteDatabase(":memory:");
  test.exec("PRAGMA foreign_keys = ON;");
  runMigrations(test);
  return test;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function runMigrations(target: DatabaseSync): void {
  target.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = target.prepare("SELECT name FROM _migrations").all() as { name: string }[];
  const applied = new Set(appliedRows.map((r) => r.name));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    target.exec("BEGIN");
    try {
      target.exec(migration.up);
      target
        .prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)")
        .run(migration.name, new Date().toISOString());
      target.exec("COMMIT");
    } catch (error) {
      target.exec("ROLLBACK");
      throw new Error(
        `Migration "${migration.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Run `fn` inside a transaction. Financial operations that touch more than one
 * table (release payment + update milestone + write activity) must use this so a
 * partial write can never leave the ledger inconsistent.
 */
export function transaction<T>(fn: () => T, target: DatabaseSync = getDb()): T {
  target.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    target.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      target.exec("ROLLBACK");
    } catch {
      // The rollback itself failing means the connection is already unwound.
    }
    throw error;
  }
}

// --- Row mapping helpers ----------------------------------------------------

export function parseJson<T>(value: unknown, fallback: T): T {
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
  return value === 1 || value === true || value === "1";
}

export function fromBool(value: boolean): number {
  return value ? 1 : 0;
}
