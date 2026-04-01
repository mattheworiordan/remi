/**
 * Test list helper — creates ephemeral lists for integration tests.
 *
 * Uses a unique prefix so test lists are obvious and can be cleaned up.
 * Registers cleanup on process exit to handle test failures.
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../dist/cli/index.js");

const createdLists: string[] = [];

// Best-effort cleanup on exit
process.on("exit", () => {
	for (const name of createdLists) {
		try {
			// Sync cleanup — can't use async in exit handler
			const { execFileSync } = require("node:child_process");
			execFileSync("node", [CLI_PATH, "delete-list", name, "--confirm", "--json"], {
				timeout: 30000,
			});
		} catch {
			// Best effort
		}
	}
});

export function testListName(): string {
	const suffix = randomBytes(3).toString("hex");
	return `_remi_test_${suffix}`;
}

export async function remi(
	...args: string[]
): Promise<{ success: boolean; data?: unknown; error?: { code: string; message: string } }> {
	const { stdout } = await execFileAsync("node", [CLI_PATH, ...args, "--json"], {
		timeout: 45000,
		env: { ...process.env },
	});
	return JSON.parse(stdout.trim());
}

export async function setupTestList(): Promise<string> {
	const name = testListName();
	const result = await remi("create-list", name);
	if (!result.success) {
		throw new Error(`Failed to create test list: ${JSON.stringify(result.error)}`);
	}
	createdLists.push(name);
	return name;
}

export async function teardownTestList(name: string): Promise<void> {
	try {
		await remi("delete-list", name, "--confirm");
		const idx = createdLists.indexOf(name);
		if (idx >= 0) createdLists.splice(idx, 1);
	} catch {
		// Best effort
	}
}

/**
 * Clean up stale test lists (from interrupted previous runs).
 */
export async function cleanupStaleTestLists(): Promise<void> {
	const result = await remi("lists");
	if (!result.success || !Array.isArray(result.data)) return;

	for (const list of result.data as Array<{ title: string }>) {
		if (list.title.startsWith("_remi_test_")) {
			try {
				await remi("delete-list", list.title, "--confirm");
			} catch {
				// Best effort
			}
		}
	}
}
