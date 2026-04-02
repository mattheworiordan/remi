import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import chalk from "chalk";
import { dbFindDb, dbStats } from "../../core/reminderkit.js";
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

	// Check compiled Swift helpers
	const { dirname: dirnameFn } = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	const currentDir = dirnameFn(fileURLToPath(import.meta.url));
	const helperDir = [join(currentDir, "../.."), join(currentDir, "../../../dist")];

	const remindersHelperExists = helperDir.some((d) => existsSync(join(d, "reminders-helper")));
	if (remindersHelperExists) {
		checks.push({
			name: "reminders-helper",
			status: "ok",
			message: "Compiled binary with permissions",
		});
	} else {
		checks.push({
			name: "reminders-helper",
			status: "warn",
			message: "Not compiled — using interpreted Swift (permissions may be attributed to terminal)",
			detail: "Run: npm run build:swift",
		});
	}

	const sectionHelperExists = helperDir.some((d) => existsSync(join(d, "section-helper")));
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

	// Check Reminders database (via compiled binary — uses its own permissions)
	try {
		const dbPath = await dbFindDb();
		checks.push({ name: "Reminders database", status: "ok", message: "Found", detail: dbPath });

		if (opts.db) {
			const stats = await dbStats();
			checks.push({
				name: "Database stats",
				status: "ok",
				message: `${stats.lists} lists, ${stats.sections} sections, ${stats.reminders} reminders`,
				detail: stats.dbPath,
			});
		}
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : "Not found";
		checks.push({
			name: "Reminders database",
			status: "warn",
			message: `Not accessible (${errMsg})`,
			detail: "Run: remi authorize (section features need Full Disk Access for your terminal app)",
		});
	}

	// Check EventKit permissions (via compiled reminders-helper, same binary used by all commands)
	try {
		const { listLists } = await import("../../core/eventkit.js");
		const lists = await listLists();
		const count = Array.isArray(lists) ? lists.length : 0;
		if (count > 0) {
			checks.push({
				name: "Reminders access",
				status: "ok",
				message: `Granted (${count} lists)`,
			});
		} else {
			// 0 lists usually means access was denied — EventKit returns empty rather than erroring
			checks.push({
				name: "Reminders access",
				status: "fail",
				message: "Not granted (0 lists returned)",
				detail: "Run: remi authorize",
			});
		}
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : "";
		checks.push({
			name: "Reminders access",
			status: "fail",
			message: errMsg.includes("denied") ? "Not granted" : `Error: ${errMsg}`,
			detail: "Run: remi authorize",
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
