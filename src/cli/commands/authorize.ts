import { execFile } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import { listLists } from "../../core/eventkit.js";
import { dbFindDb } from "../../core/reminderkit.js";
import { isJsonMode, outputError } from "../output.js";

const execFileAsync = promisify(execFile);

function out(text: string): void {
	if (!isJsonMode()) process.stdout.write(text);
}

export async function authorizeCommand(): Promise<void> {
	out(chalk.bold("\nremi authorize\n"));
	out(`${"─".repeat(20)}\n\n`);
	out(
		chalk.dim(
			"macOS grants permissions to your terminal app (Terminal, iTerm, Cursor, etc.),\nnot to remi directly. You only need to do this once per terminal app.\n",
		),
	);

	// Step 1: Reminders access
	out("\n1. Checking Reminders access...\n");
	out(chalk.dim("   If a system dialog appears, click Allow.\n"));

	let remindersOk = false;
	try {
		const lists = await listLists();
		const count = Array.isArray(lists) ? lists.length : 0;
		if (count > 0) {
			out(
				`   ${chalk.green("✓")} Reminders access granted (${count} list${count === 1 ? "" : "s"} found)\n`,
			);
			remindersOk = true;
		} else {
			out(chalk.yellow("   ✗ Reminders access appears denied (0 lists returned)\n"));
			out("     Opening System Settings — enable your terminal app under Reminders.\n");
			try {
				await execFileAsync("open", [
					"x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders",
				]);
			} catch {
				out(chalk.dim("     Go to: System Settings > Privacy & Security > Reminders\n"));
			}
			out(chalk.dim("     After enabling, restart your terminal and run remi authorize again.\n"));
		}
	} catch {
		out(chalk.yellow("   ✗ Reminders access not granted.\n"));
		out("     Opening System Settings — enable your terminal app under Reminders.\n");
		try {
			await execFileAsync("open", [
				"x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders",
			]);
		} catch {
			out(chalk.dim("     Go to: System Settings > Privacy & Security > Reminders\n"));
		}
	}

	// Step 2: Database access (Full Disk Access)
	out("\n2. Checking database access (for section features)...\n");

	try {
		const dbPath = await dbFindDb();
		out(`   ${chalk.green("✓")} Database access granted (${dbPath.split("/").pop()})\n`);
	} catch {
		out(chalk.yellow("   ✗ Database access not yet granted.\n"));
		out("     Section features (create-section, move, etc.) need Full Disk Access.\n");
		out("     Opening System Settings — add your terminal app to Full Disk Access.\n");
		try {
			await execFileAsync("open", [
				"x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
			]);
		} catch {
			out(chalk.dim("     Go to: System Settings > Privacy & Security > Full Disk Access\n"));
		}
		out(chalk.dim("     After enabling, restart your terminal and run remi authorize again.\n"));
	}

	out(chalk.dim("\nRun 'remi doctor' to verify all permissions.\n\n"));
}
