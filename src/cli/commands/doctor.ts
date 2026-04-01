import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import chalk from "chalk";
import { findRemindersDbPath, getDb } from "../../core/sqlite.js";
import { isJsonMode, outputSuccess } from "../output.js";

const execFileAsync = promisify(execFile);

interface CheckResult {
	name: string;
	status: "ok" | "warn" | "fail";
	message: string;
	detail?: string;
}

export async function doctorCommand(opts: { sync?: boolean; db?: boolean }): Promise<void> {
	const checks: CheckResult[] = [];

	// Check macOS version
	try {
		const { stdout } = await execFileAsync("sw_vers", ["-productVersion"]);
		const version = stdout.trim();
		const major = Number.parseInt(version.split(".")[0], 10);
		if (major >= 13) {
			checks.push({ name: "macOS version", status: "ok", message: `macOS ${version}` });
		} else {
			checks.push({
				name: "macOS version",
				status: "fail",
				message: `macOS ${version} (requires 13+)`,
			});
		}
	} catch {
		checks.push({
			name: "macOS version",
			status: "fail",
			message: "Could not determine macOS version",
		});
	}

	// Check Swift
	try {
		const { stdout } = await execFileAsync("/usr/bin/swift", ["--version"]);
		const match = stdout.match(/Swift version ([\d.]+)/);
		checks.push({
			name: "Swift",
			status: "ok",
			message: match ? `Swift ${match[1]}` : "Available",
		});
	} catch {
		checks.push({
			name: "Swift",
			status: "fail",
			message: "Not found",
			detail: "Install Xcode Command Line Tools: xcode-select --install",
		});
	}

	// Check section-helper binary
	const { dirname: dirnameFn } = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	const currentDir = dirnameFn(fileURLToPath(import.meta.url));
	// From dist/cli/commands/ -> dist/section-helper
	const sectionHelperPaths = [
		join(currentDir, "../../section-helper"),
		join(currentDir, "../../../dist/section-helper"),
	];
	const sectionHelperExists = sectionHelperPaths.some(existsSync);
	if (sectionHelperExists) {
		checks.push({ name: "section-helper", status: "ok", message: "Compiled binary found" });
	} else {
		checks.push({
			name: "section-helper",
			status: "warn",
			message: "Not compiled (section operations unavailable)",
			detail: "Run: npm run build:swift",
		});
	}

	// Check Reminders database
	try {
		const dbPath = findRemindersDbPath();
		checks.push({ name: "Reminders database", status: "ok", message: "Found", detail: dbPath });

		if (opts.db) {
			const db = getDb();
			const reminderCount = (
				db
					.prepare("SELECT COUNT(*) as cnt FROM ZREMCDREMINDER WHERE ZMARKEDFORDELETION = 0")
					.get() as {
					cnt: number;
				}
			).cnt;
			const listCount = (
				db
					.prepare("SELECT COUNT(*) as cnt FROM ZREMCDBASELIST WHERE ZMARKEDFORDELETION = 0")
					.get() as {
					cnt: number;
				}
			).cnt;
			const sectionCount = (
				db
					.prepare("SELECT COUNT(*) as cnt FROM ZREMCDBASESECTION WHERE ZMARKEDFORDELETION = 0")
					.get() as {
					cnt: number;
				}
			).cnt;
			checks.push({
				name: "Database stats",
				status: "ok",
				message: `${listCount} lists, ${sectionCount} sections, ${reminderCount} reminders`,
				detail: dbPath,
			});
		}
	} catch (err) {
		checks.push({
			name: "Reminders database",
			status: "fail",
			message: err instanceof Error ? err.message : "Not found",
			detail: "Ensure Apple Reminders is set up with at least one reminder",
		});
	}

	// Check EventKit permissions
	try {
		const { stdout } = await execFileAsync(
			"/usr/bin/swift",
			[
				"-e",
				'import EventKit; let s = EKEventStore(); print(s.calendars(for: .reminder).count > 0 ? "ok" : "no_access")',
			],
			{ timeout: 15000 },
		);
		if (stdout.trim() === "ok") {
			checks.push({ name: "Reminders access", status: "ok", message: "Granted" });
		} else {
			checks.push({
				name: "Reminders access",
				status: "fail",
				message: "Not granted",
				detail: "Grant in System Settings > Privacy & Security > Reminders",
			});
		}
	} catch {
		checks.push({
			name: "Reminders access",
			status: "warn",
			message: "Could not verify (may need to grant access on first use)",
		});
	}

	// Check Reminders stores dir
	const storesDir = join(
		homedir(),
		"Library/Group Containers/group.com.apple.reminders/Container_v1/Stores",
	);
	if (existsSync(storesDir)) {
		checks.push({ name: "Reminders data dir", status: "ok", message: "Exists" });
	} else {
		checks.push({
			name: "Reminders data dir",
			status: "fail",
			message: "Not found",
			detail: storesDir,
		});
	}

	// Output
	if (isJsonMode()) {
		outputSuccess(checks);
		return;
	}

	process.stdout.write(chalk.bold("\nremi doctor\n"));
	process.stdout.write(`${"─".repeat(40)}\n`);

	for (const check of checks) {
		const icon =
			check.status === "ok"
				? chalk.green("✓")
				: check.status === "warn"
					? chalk.yellow("⚠")
					: chalk.red("✗");
		process.stdout.write(`${icon} ${chalk.bold(check.name)}: ${check.message}\n`);
		if (check.detail) {
			process.stdout.write(chalk.dim(`  ${check.detail}\n`));
		}
	}

	const failures = checks.filter((c) => c.status === "fail");
	if (failures.length > 0) {
		process.stdout.write(chalk.red(`\n${failures.length} issue(s) found.\n`));
		process.exit(1);
	} else {
		process.stdout.write(chalk.green("\nAll checks passed.\n"));
	}
}
