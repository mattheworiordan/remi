/**
 * ReminderKit bridge — executes the compiled section-helper binary
 * for section CRUD and sync trigger operations.
 *
 * The section-helper uses Apple's private ReminderKit framework for
 * section operations (which properly sync via CloudKit) and EventKit
 * for triggering sync cycles.
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

	// From dist/core/ -> dist/section-helper
	const fromDist = join(currentDir, "../section-helper");
	// From src/core/ -> dist/section-helper (dev mode via tsx)
	const fromSrcDev = join(currentDir, "../../dist/section-helper");

	if (existsSync(fromDist)) return fromDist;
	if (existsSync(fromSrcDev)) return fromSrcDev;

	throw new RemiCommandError(
		ErrorCode.REMINDERKIT_UNAVAILABLE,
		"section-helper binary not found",
		"Run: npm run build:swift (or bash src/swift/build.sh)",
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

/**
 * Trigger a CloudKit sync cycle by making a trivial EventKit edit.
 * Call this after writing membership data to SQLite.
 *
 * Returns a warning string if the sync trigger couldn't fire (non-fatal).
 */
export async function triggerSync(listName: string): Promise<string | undefined> {
	const result = await runSectionHelper("trigger-sync", listName);
	if (!result.success) {
		// Non-fatal: membership data is written, will sync on next natural change
		return result.error || "Sync trigger failed";
	}
	return result.warning;
}
