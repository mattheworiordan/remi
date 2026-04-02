/**
 * EventKit bridge — executes the Swift helper script for Apple Reminders operations.
 *
 * The Swift helper runs interpreted via /usr/bin/swift and communicates via JSON.
 * It handles EventKit permissions, async fetching, and all standard CRUD operations.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Reminder, ReminderList } from "../types.js";
import { ErrorCode, RemiCommandError } from "./errors.js";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 30000;

/**
 * Find the reminders-helper binary (preferred) or fall back to interpreted Swift script.
 *
 * The compiled binary has an embedded Info.plist with NSRemindersUsageDescription,
 * so macOS attributes the Reminders permission to "remi" rather than the terminal app.
 */
function findHelper(): { path: string; isCompiled: boolean } {
	const currentDir = dirname(fileURLToPath(import.meta.url));

	// Prefer compiled binary (has Info.plist for proper permissions)
	const binaryPaths = [
		join(currentDir, "../reminders-helper"), // From dist/core/ -> dist/reminders-helper
		join(currentDir, "../../dist/reminders-helper"), // From src/core/ -> dist/reminders-helper
	];
	for (const p of binaryPaths) {
		if (existsSync(p)) return { path: p, isCompiled: true };
	}

	// Fall back to interpreted Swift script
	const scriptPaths = [
		join(currentDir, "../../src/swift/reminders-helper.swift"), // From dist/core/
		join(currentDir, "../swift/reminders-helper.swift"), // From src/core/
	];
	for (const p of scriptPaths) {
		if (existsSync(p)) return { path: p, isCompiled: false };
	}

	throw new RemiCommandError(
		ErrorCode.SWIFT_NOT_FOUND,
		"reminders-helper not found",
		"Run: npm run build:swift",
	);
}

interface SwiftResult<T> {
	success: boolean;
	data?: T;
	error?: string;
}

async function runSwift<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	const helper = findHelper();

	let execPath: string;
	let cmdArgs: string[];

	if (helper.isCompiled) {
		execPath = helper.path;
		cmdArgs = [command];
	} else {
		execPath = "/usr/bin/swift";
		cmdArgs = [helper.path, command];
	}

	if (args) {
		cmdArgs.push(JSON.stringify(args));
	}

	try {
		const { stdout } = await execFileAsync(execPath, cmdArgs, {
			timeout: TIMEOUT_MS,
			env: { ...process.env },
		});
		return JSON.parse(stdout.trim()) as T;
	} catch (error: unknown) {
		const err = error as { stdout?: string; stderr?: string; code?: string; message?: string };

		if (err.stdout) {
			try {
				const result = JSON.parse(err.stdout.trim());
				if (result.error) {
					throw new RemiCommandError(ErrorCode.SWIFT_EXECUTION_FAILED, result.error);
				}
			} catch (parseErr) {
				if (parseErr instanceof RemiCommandError) throw parseErr;
			}
		}

		if (err.code === "ENOENT") {
			throw new RemiCommandError(
				ErrorCode.SWIFT_NOT_FOUND,
				"Swift not found at /usr/bin/swift",
				"Install Xcode Command Line Tools: xcode-select --install",
			);
		}

		throw new RemiCommandError(
			ErrorCode.SWIFT_EXECUTION_FAILED,
			`Swift helper failed: ${err.stderr || err.message}`,
		);
	}
}

async function runSwiftCommand<T = string>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T> {
	const result = await runSwift<SwiftResult<T>>(command, args);
	if (!result.success) {
		const msg = result.error || "Unknown error from Swift helper";
		if (msg.includes("not found")) {
			throw new RemiCommandError(ErrorCode.LIST_NOT_FOUND, msg);
		}
		if (msg.includes("access denied") || msg.includes("denied")) {
			throw new RemiCommandError(
				ErrorCode.PERMISSION_DENIED,
				"Reminders access not granted",
				"Run: remi authorize (then check System Settings > Privacy & Security > Reminders)",
			);
		}
		throw new RemiCommandError(ErrorCode.SWIFT_EXECUTION_FAILED, msg);
	}
	return result.data as T;
}

// -- Public API --

export async function listLists(): Promise<ReminderList[]> {
	return runSwift<ReminderList[]>("list-lists");
}

export async function getReminders(opts: {
	list?: string;
	filter?: string;
	days?: number;
}): Promise<Reminder[]> {
	return runSwift<Reminder[]>("get-reminders", opts);
}

export async function searchReminders(query: string): Promise<Reminder[]> {
	return runSwift<Reminder[]>("search", { query });
}

export async function createReminder(opts: {
	title: string;
	listName: string;
	due?: string;
	notes?: string;
	priority?: string;
	rruleFreq?: string;
	rruleInterval?: number;
	rruleDays?: number[];
	rruleEnd?: string;
}): Promise<string> {
	return runSwiftCommand<string>("create", opts);
}

export async function editReminder(opts: {
	id: string;
	title?: string;
	listName?: string;
	due?: string;
	clearDue?: boolean;
	notes?: string;
	priority?: string;
}): Promise<string> {
	return runSwiftCommand<string>("edit", opts);
}

export async function completeReminder(id: string): Promise<string> {
	return runSwiftCommand<string>("complete", { id });
}

export async function deleteReminder(id: string): Promise<string> {
	return runSwiftCommand<string>("delete", { id });
}

export async function createList(name: string): Promise<string> {
	return runSwiftCommand<string>("create-list", { name });
}

export async function deleteList(name: string): Promise<string> {
	return runSwiftCommand<string>("delete-list", { name });
}
