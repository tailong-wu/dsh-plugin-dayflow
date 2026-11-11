/**
 * SQLite access for both the Dayflow source and the plugin-owned journal.
 *
 * Dayflow reads go straight to `chunks.sqlite`, so they work while the app is closed.
 * The connection is opened `readOnly` and additionally pinned with
 * `PRAGMA query_only`, so a bug here cannot corrupt the journal the app owns.
 * `node:sqlite` is loaded lazily: a Node build without it still loads the
 * plugin, and only calls that need the database report the version problem.
 * @module dsh-plugin-dayflow/db
 */

import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { DayflowError } from './errors.js';
import { defaultDatabasePath } from './paths.js';

/** The subset of `node:sqlite` these modules use. */
interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean; timeout?: number }) => DatabaseSync;
}

/** One raw row, keyed by column name. */
export type SqlRow = Record<string, unknown>;

const require = createRequire(import.meta.url);
let sqlite: SqliteModule | undefined;

/** Minimum Node release whose `node:sqlite` needs no experimental flag. */
const MIN_NODE_WITH_SQLITE = '22.5.0';

function loadSqlite(): SqliteModule {
  if (sqlite !== undefined) return sqlite;
  try {
    sqlite = require('node:sqlite') as SqliteModule;
    return sqlite;
  } catch (cause) {
    throw new DayflowError(
      `This Node.js (${process.versions.node}) has no built-in SQLite. Dayflow support needs Node ` +
        `${MIN_NODE_WITH_SQLITE} or newer (Node 22.5–23.3 also works when started with ` +
        `--experimental-sqlite).`,
      'database_error',
      { cause },
    );
  }
}

/**
 * Which database to read: explicit config, then `DAYFLOW_DB`, then the app's path.
 * @param override - the plugin's `databasePath` setting, when set.
 * @returns the absolute path to open.
 */
export function resolveDatabasePath(override?: string): string {
  const configured = override?.trim();
  if (configured !== undefined && configured !== '') return configured;
  const fromEnvironment = process.env.DAYFLOW_DB?.trim();
  if (fromEnvironment !== undefined && fromEnvironment !== '') return fromEnvironment;
  return defaultDatabasePath();
}

/**
 * Open a read-only connection to a Dayflow database.
 * @param path - absolute path to `chunks.sqlite`.
 * @returns the open connection; the caller owns closing it.
 */
export function openDatabase(path: string): DatabaseSync {
  if (!existsSync(path)) {
    throw new DayflowError(
      `No Dayflow database at ${path}. Open the Dayflow app on this Mac and let it record something first.`,
      'no_data',
    );
  }
  const { DatabaseSync: Database } = loadSqlite();
  try {
    // The app runs in WAL mode; a short busy timeout rides out a checkpoint.
    const db = new Database(path, { readOnly: true, timeout: 2000 });
    db.exec('PRAGMA query_only = 1');
    return db;
  } catch (cause) {
    throw new DayflowError(
      `Could not open the Dayflow database at ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      'database_error',
      { cause },
    );
  }
}

/**
 * Run one read against a fresh connection and close it afterwards.
 * @param path - absolute path to `chunks.sqlite`.
 * @param read - the work to perform with the connection.
 * @returns whatever `read` returns.
 */
export function withDatabase<T>(path: string, read: (db: DatabaseSync) => T): T {
  const db = openDatabase(path);
  try {
    return read(db);
  } finally {
    db.close();
  }
}

/**
 * Open a writable SQLite connection for the plugin-owned journal.
 *
 * This is intentionally separate from {@link openDatabase}: Dayflow's source
 * database remains read-only, while the owned journal may create tables and
 * import rows. Parent directories are created lazily on first open.
 */
export function openJournalDatabase(path: string): DatabaseSync {
  const { DatabaseSync: Database } = loadSqlite();
  try {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const db = new Database(path, { timeout: 2000 });
    chmodSync(path, 0o600);
    return db;
  } catch (cause) {
    throw new DayflowError(
      `Could not open the owned journal database at ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      'database_error',
      { cause },
    );
  }
}

/** Alias for callers that describe this as a generic writable runtime store. */
export const openWritableDatabase = openJournalDatabase;

/** Run one callback against a writable, caller-owned journal connection. */
export function withJournalDatabase<T>(path: string, write: (db: DatabaseSync) => T): T {
  const db = openJournalDatabase(path);
  try {
    return write(db);
  } finally {
    db.close();
  }
}

/** Alias for backend code that calls the journal the runtime database. */
export const withRuntimeDatabase = withJournalDatabase;

/**
 * Run one statement and return its rows.
 * @param db - an open connection.
 * @param sql - the statement, with `?` placeholders.
 * @param parameters - values bound in order.
 * @returns the rows.
 */
export function queryRows(db: DatabaseSync, sql: string, parameters: readonly unknown[] = []): SqlRow[] {
  try {
    const statement = db.prepare(sql);
    return statement.all(...(parameters as never[])) as SqlRow[];
  } catch (cause) {
    throw new DayflowError(
      `Dayflow's database rejected a query: ${cause instanceof Error ? cause.message : String(cause)}`,
      'database_error',
      { cause },
    );
  }
}
