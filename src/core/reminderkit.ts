/**
 * ReminderKit bridge — executes the compiled section-helper binary
 * for section CRUD, sync trigger, and database operations.
 *
 * Permissions note: macOS TCC always attributes permissions to the
 * "responsible process" (the terminal app), not the child binary.
 * The embedded Info.plist provides NSRemindersUsageDescription for
 * the permission dialog text, but the grant goes to the terminal.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Section } from "../types.js";
import { ErrorCode, RemiCommandError } from "./errors.js";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 30000;

function findSectionHelper(): string {
	const currentDir = dirname(fileURLToPath(import.meta.url));

	const candidates = [
		join(currentDir, "../section-helper"), // From dist/core/ -> dist/section-helper
		join(currentDir, "../../dist/section-helper"), // From src/core/ -> dist/section-helper
	];
	for (const p of candidates) {
		if (existsSync(p)) return p;
	}

	throw new RemiCommandError(
		ErrorCode.REMINDERKIT_UNAVAILABLE,
		"section-helper binary not found",
		"Run: npm run build:swift",
	);
}

interface SectionHelperResult {
	success: boolean;
	message?: string;
	error?: string;
	warning?: string;
	sections?: Array<{ name: string; objectID: string }>;
}

async function runSectionHelper(command: string, ...args: string[]): Promise<SectionHelperResult> {
	const binaryPath = findSectionHelper();
	const cmdArgs = [command, ...args];

	try {
		const { stdout } = await execFileAsync(binaryPath, cmdArgs, {
			timeout: TIMEOUT_MS,
			env: { ...process.env },
		});
		return JSON.parse(stdout.trim()) as SectionHelperResult;
	} catch (error: unknown) {
		const err = error as { stdout?: string; stderr?: string; message?: string };

		if (err.stdout) {
			try {
				const result = JSON.parse(err.stdout.trim()) as SectionHelperResult;
				if (result.error) {
					throw new RemiCommandError(ErrorCode.REMINDERKIT_UNAVAILABLE, result.error);
				}
			} catch (parseErr) {
				if (parseErr instanceof RemiCommandError) throw parseErr;
			}
		}

		throw new RemiCommandError(
			ErrorCode.REMINDERKIT_UNAVAILABLE,
			`Section helper failed: ${err.stderr || err.message}`,
			"Ensure macOS 13+ and Xcode Command Line Tools are installed",
		);
	}
}

export async function listSections(listName: string): Promise<Section[]> {
	const result = await runSectionHelper("list-sections", listName);
	if (!result.success) {
		throw new RemiCommandError(
			ErrorCode.LIST_NOT_FOUND,
			result.error || `Failed to list sections for "${listName}"`,
		);
	}

	return (result.sections || []).map((s, i) => ({
		id: s.objectID,
		displayName: s.name,
		listName,
		sortOrder: i,
	}));
}

export async function createSection(listName: string, sectionName: string): Promise<string> {
	const result = await runSectionHelper("create-section", listName, sectionName);
	if (!result.success) {
		throw new RemiCommandError(
			ErrorCode.REMINDERKIT_UNAVAILABLE,
			result.error || `Failed to create section "${sectionName}"`,
		);
	}
	return result.message || "OK";
}

export async function deleteSection(listName: string, sectionName: string): Promise<string> {
	const result = await runSectionHelper("delete-section", listName, sectionName);
	if (!result.success) {
		throw new RemiCommandError(
			ErrorCode.SECTION_NOT_FOUND,
			result.error || `Failed to delete section "${sectionName}"`,
		);
	}
	return result.message || "OK";
}

export async function triggerSync(listName: string): Promise<string | undefined> {
	const result = await runSectionHelper("trigger-sync", listName);
	if (!result.success) {
		return result.error || "Sync trigger failed";
	}
	return result.warning;
}

// -- Database commands --

interface DbResult {
	success: boolean;
	error?: string;
	pk: number;
	identifier: string;
	data: string | null;
	dbPath: string;
	lists: number;
	sections: number;
	reminders: number;
	message?: string;
	warning?: string;
}

async function runDbCommand(command: string, ...args: string[]): Promise<DbResult> {
	return runSectionHelper(command, ...args) as unknown as Promise<DbResult>;
}

export async function dbFindDb(): Promise<string> {
	const result = await runDbCommand("db-find-db");
	if (!result.success) {
		throw new RemiCommandError(ErrorCode.DB_NOT_FOUND, result.error || "Database not found");
	}
	return result.dbPath;
}

export async function dbStats(): Promise<{
	dbPath: string;
	lists: number;
	sections: number;
	reminders: number;
}> {
	const result = await runDbCommand("db-stats");
	if (!result.success) {
		throw new RemiCommandError(ErrorCode.DB_NOT_FOUND, result.error || "Database not found");
	}
	return {
		dbPath: result.dbPath,
		lists: result.lists,
		sections: result.sections,
		reminders: result.reminders,
	};
}

export async function dbFindList(listName: string): Promise<number> {
	const result = await runDbCommand("db-find-list", listName);
	if (!result.success) {
		throw new RemiCommandError(
			ErrorCode.LIST_NOT_FOUND,
			result.error || `List "${listName}" not found`,
		);
	}
	return result.pk;
}

export async function dbFindReminder(
	title: string,
	listName: string,
): Promise<{ pk: number; identifier: string }> {
	const result = await runDbCommand("db-find-reminder", title, listName);
	if (!result.success) {
		throw new RemiCommandError(
			ErrorCode.REMINDER_NOT_FOUND,
			result.error || `Reminder "${title}" not found`,
		);
	}
	return { pk: result.pk, identifier: result.identifier };
}

export async function dbFindSection(
	sectionName: string,
	listName: string,
): Promise<{ pk: number; identifier: string }> {
	const result = await runDbCommand("db-find-section", sectionName, listName);
	if (!result.success) {
		throw new RemiCommandError(
			ErrorCode.SECTION_NOT_FOUND,
			result.error || `Section "${sectionName}" not found`,
		);
	}
	return { pk: result.pk, identifier: result.identifier };
}

export async function dbReadMemberships(listName: string): Promise<string | null> {
	const result = await runDbCommand("db-read-memberships", listName);
	if (!result.success) {
		throw new RemiCommandError(
			ErrorCode.DB_NOT_FOUND,
			result.error || "Failed to read memberships",
		);
	}
	return result.data ?? null;
}

export async function dbReadTokenMap(listName: string): Promise<string | null> {
	const result = await runDbCommand("db-read-tokenmap", listName);
	if (!result.success) {
		throw new RemiCommandError(ErrorCode.DB_NOT_FOUND, result.error || "Failed to read token map");
	}
	return result.data ?? null;
}

export async function dbWriteMembershipSync(
	listName: string,
	membershipJSON: string,
): Promise<string | undefined> {
	const result = await runDbCommand("db-write-membership-sync", listName, membershipJSON);
	if (!result.success) {
		throw new RemiCommandError(
			ErrorCode.SYNC_TRIGGER_FAILED,
			result.error || "Membership sync failed",
		);
	}
	return result.warning;
}
