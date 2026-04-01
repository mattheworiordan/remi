/**
 * SQLite access for Apple Reminders database.
 *
 * Uses better-sqlite3 for proper transactions and prepared statements.
 * This is a key improvement over the predecessor which shelled out to /usr/bin/sqlite3
 * for each statement, making the 3-step membership write non-atomic.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { ErrorCode, RemiCommandError } from "./errors.js";

const STORES_DIR = join(
	homedir(),
	"Library/Group Containers/group.com.apple.reminders/Container_v1/Stores",
);

let cachedDbPath: string | null = null;
let cachedDb: Database.Database | null = null;

/**
 * Find the active Apple Reminders SQLite database.
 * Scans all .sqlite files and returns the one with actual reminder data.
 */
export function findRemindersDbPath(): string {
	if (cachedDbPath) return cachedDbPath;

	if (!existsSync(STORES_DIR)) {
		throw new RemiCommandError(
			ErrorCode.DB_NOT_FOUND,
			`Reminders data directory not found at ${STORES_DIR}`,
			"Is Apple Reminders set up on this Mac?",
		);
	}

	const sqliteFiles = readdirSync(STORES_DIR).filter(
		(f) => f.endsWith(".sqlite") && !f.includes("-wal") && !f.includes("-shm"),
	);

	for (const file of sqliteFiles) {
		const dbPath = join(STORES_DIR, file);
		try {
			const db = new Database(dbPath, { readonly: true });
			const row = db.prepare("SELECT COUNT(*) as cnt FROM ZREMCDREMINDER").get() as {
				cnt: number;
			};
			db.close();
			if (row.cnt > 0) {
				cachedDbPath = dbPath;
				return dbPath;
			}
		} catch {
			// Skip files that don't have the expected schema
		}
	}

	throw new RemiCommandError(
		ErrorCode.DB_NOT_FOUND,
		`No active Reminders database found in ${STORES_DIR}`,
		`Checked ${sqliteFiles.length} files. Ensure you have reminders in Apple Reminders.`,
	);
}

/**
 * Get a database connection. Caches the connection for reuse.
 * Uses WAL mode and busy_timeout for safe concurrent access with remindd.
 */
export function getDb(): Database.Database {
	if (cachedDb) return cachedDb;

	const dbPath = findRemindersDbPath();
	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("busy_timeout = 5000");
	cachedDb = db;
	return db;
}

/**
 * Close the cached database connection.
 */
export function closeDb(): void {
	if (cachedDb) {
		cachedDb.close();
		cachedDb = null;
	}
}

/**
 * Find a list's Z_PK by name.
 */
export function findListPk(listName: string): number {
	const db = getDb();
	const row = db
		.prepare("SELECT Z_PK FROM ZREMCDBASELIST WHERE ZNAME = ? AND ZMARKEDFORDELETION = 0")
		.get(listName) as { Z_PK: number } | undefined;

	if (!row) {
		throw new RemiCommandError(
			ErrorCode.LIST_NOT_FOUND,
			`List "${listName}" not found in database`,
		);
	}
	return row.Z_PK;
}

/**
 * Find a reminder's identifier (hex UUID) by title and list name.
 */
export function findReminderIdentifier(
	title: string,
	listName: string,
): { pk: number; identifier: string } {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT r.Z_PK, hex(r.ZIDENTIFIER) as identifier
       FROM ZREMCDREMINDER r
       JOIN ZREMCDBASELIST l ON r.ZLIST = l.Z_PK
       WHERE r.ZTITLE = ? AND l.ZNAME = ? AND r.ZCOMPLETED = 0 AND r.ZMARKEDFORDELETION = 0
       ORDER BY r.ZCREATIONDATE DESC LIMIT 1`,
		)
		.get(title, listName) as { Z_PK: number; identifier: string } | undefined;

	if (!row) {
		throw new RemiCommandError(
			ErrorCode.REMINDER_NOT_FOUND,
			`Reminder "${title}" not found in "${listName}"`,
		);
	}
	return { pk: row.Z_PK, identifier: row.identifier };
}

/**
 * Find a section's identifier (hex UUID) by name and list.
 */
export function findSectionIdentifier(
	sectionName: string,
	listName: string,
): { pk: number; identifier: string } {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT s.Z_PK, hex(s.ZIDENTIFIER) as identifier
       FROM ZREMCDBASESECTION s
       JOIN ZREMCDBASELIST l ON s.ZLIST = l.Z_PK
       WHERE s.ZDISPLAYNAME = ? AND l.ZNAME = ? AND s.ZMARKEDFORDELETION = 0`,
		)
		.get(sectionName, listName) as { Z_PK: number; identifier: string } | undefined;

	if (!row) {
		throw new RemiCommandError(
			ErrorCode.SECTION_NOT_FOUND,
			`Section "${sectionName}" not found in "${listName}"`,
		);
	}
	return { pk: row.Z_PK, identifier: row.identifier };
}

/**
 * Read the current membership data JSON from a list.
 */
export function readMembershipData(listPk: number): string | null {
	const db = getDb();
	const row = db
		.prepare(
			"SELECT cast(ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA as text) as data FROM ZREMCDBASELIST WHERE Z_PK = ?",
		)
		.get(listPk) as { data: string | null } | undefined;

	return row?.data || null;
}

/**
 * Read the resolution token map JSON from a list.
 * The token map may be stored as a BLOB or TEXT — handle both.
 */
export function readTokenMap(listPk: number): string | null {
	const db = getDb();
	const row = db
		.prepare(
			"SELECT cast(ZRESOLUTIONTOKENMAP_V3_JSONDATA as text) as data FROM ZREMCDBASELIST WHERE Z_PK = ?",
		)
		.get(listPk) as { data: string | null } | undefined;

	return row?.data || null;
}

/**
 * Write membership data, checksum, and token map in a SINGLE ATOMIC TRANSACTION.
 *
 * This is the key improvement over the predecessor which used separate sqlite3 process
 * calls for each statement. A partial write (data updated but checksum not) would cause
 * remindd to detect data corruption.
 */
export function writeMembershipSync(
	listPk: number,
	membershipJson: string,
	checksumHex: string,
	tokenMapJson: string,
): void {
	const db = getDb();

	const writeAll = db.transaction(() => {
		db.prepare(
			"UPDATE ZREMCDBASELIST SET ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA = ? WHERE Z_PK = ?",
		).run(membershipJson, listPk);

		db.prepare(
			"UPDATE ZREMCDBASELIST SET ZMEMBERSHIPSOFREMINDERSINSECTIONSCHECKSUM = ? WHERE Z_PK = ?",
		).run(checksumHex, listPk);

		db.prepare("UPDATE ZREMCDBASELIST SET ZRESOLUTIONTOKENMAP_V3_JSONDATA = ? WHERE Z_PK = ?").run(
			tokenMapJson,
			listPk,
		);
	});

	writeAll();
}

/**
 * Convert a hex blob string (32 chars, no hyphens) to standard UUID format.
 */
export function hexToUuid(hex: string): string {
	const h = hex.toUpperCase();
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Convert a JS Date to Core Data timestamp (seconds since 2001-01-01 00:00:00 UTC).
 */
export function coreDataTimestamp(date?: Date): number {
	const d = date || new Date();
	return d.getTime() / 1000 - 978307200;
}
