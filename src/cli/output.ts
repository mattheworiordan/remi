import chalk from "chalk";
import type { RemiError, RemiResult, Reminder, ReminderList, Section } from "../types.js";

let jsonMode = false;
let verboseMode = false;

export function setJsonMode(enabled: boolean): void {
	jsonMode = enabled;
}

export function isJsonMode(): boolean {
	return jsonMode;
}

export function setVerboseMode(enabled: boolean): void {
	verboseMode = enabled;
}

// -- Date formatting --

function formatRelativeDate(dateStr: string): {
	text: string;
	isOverdue: boolean;
	isToday: boolean;
} {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const due = new Date(`${dateStr}T00:00:00`);
	const diffMs = due.getTime() - today.getTime();
	const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays < 0) {
		const absDays = Math.abs(diffDays);
		const label = absDays === 1 ? "1d overdue" : `${absDays}d overdue`;
		return { text: label, isOverdue: true, isToday: false };
	}
	if (diffDays === 0) return { text: "today", isOverdue: false, isToday: true };
	if (diffDays === 1) return { text: "tomorrow", isOverdue: false, isToday: false };
	if (diffDays <= 7) return { text: `in ${diffDays}d`, isOverdue: false, isToday: false };

	// Format as "Apr 28" for dates within the year, "Apr 28 2027" for other years
	const months = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];
	const month = months[due.getMonth()];
	const day = due.getDate();
	if (due.getFullYear() === now.getFullYear()) {
		return { text: `${month} ${day}`, isOverdue: false, isToday: false };
	}
	return { text: `${month} ${day} ${due.getFullYear()}`, isOverdue: false, isToday: false };
}

function colorDate(dateStr: string, context?: "today" | "overdue"): string {
	// Skip redundant date display in context-specific views
	if (context === "today") return "";
	if (context === "overdue") {
		const { text } = formatRelativeDate(dateStr);
		return chalk.red(text);
	}

	const { text, isOverdue, isToday } = formatRelativeDate(dateStr);
	if (isOverdue) return chalk.red(text);
	if (isToday) return chalk.yellow(text);
	return chalk.dim(text);
}

// -- Core output functions --

/** Output a successful result */
export function outputSuccess<T>(data: T): void {
	if (jsonMode) {
		const result: RemiResult<T> = { success: true, data };
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} else {
		process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
	}
}

/** Output an error result */
export function outputError(error: RemiError): void {
	if (jsonMode) {
		const result: RemiResult<never> = { success: false, error };
		process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
	} else {
		process.stderr.write(chalk.red(`Error: ${error.message}\n`));
		if (error.suggestion) {
			process.stderr.write(chalk.yellow(`Suggestion: ${error.suggestion}\n`));
		}
	}
}

/** Format and output a list of reminder lists */
export function outputLists(lists: ReminderList[]): void {
	if (jsonMode) {
		outputSuccess(lists);
		return;
	}

	if (lists.length === 0) {
		process.stdout.write("No reminder lists found.\n");
		return;
	}

	const maxNameLen = Math.max(...lists.map((l) => l.title.length), 4);

	process.stdout.write(
		`${chalk.bold("Name".padEnd(maxNameLen))}  ${chalk.bold("Count")}  ${chalk.bold("Overdue")}\n`,
	);
	process.stdout.write(`${"─".repeat(maxNameLen + 16)}\n`);

	for (const list of lists) {
		const count = String(list.reminderCount).padStart(5);
		const overdue =
			list.overdueCount > 0
				? chalk.red(String(list.overdueCount).padStart(7))
				: chalk.dim(String(0).padStart(7));
		process.stdout.write(`${list.title.padEnd(maxNameLen)}  ${count}  ${overdue}\n`);
	}
}

/** Options for reminder display */
interface OutputRemindersOpts {
	/** View context — suppresses redundant info */
	context?: "today" | "overdue" | "upcoming" | "search" | "list";
	/** Show which list each reminder belongs to (for cross-list views) */
	showList?: boolean;
	/** Sort by due date */
	sortByDate?: boolean;
}

/** Format and output a list of reminders */
export function outputReminders(
	reminders: Reminder[],
	listName?: string,
	opts?: OutputRemindersOpts,
): void {
	if (jsonMode) {
		outputSuccess(reminders);
		return;
	}

	if (reminders.length === 0) {
		const ctx = listName ? ` in "${listName}"` : "";
		process.stdout.write(`No reminders found${ctx}.\n`);
		return;
	}

	// Sort by date if requested
	let sorted = reminders;
	if (opts?.sortByDate) {
		sorted = [...reminders].sort((a, b) => {
			if (!a.dueDate && !b.dueDate) return 0;
			if (!a.dueDate) return 1;
			if (!b.dueDate) return -1;
			return a.dueDate.localeCompare(b.dueDate);
		});
	}

	// Header with summary
	if (listName) {
		const overdueCount = sorted.filter((r) => {
			if (!r.dueDate) return false;
			const { isOverdue } = formatRelativeDate(r.dueDate);
			return isOverdue;
		}).length;

		const summary = [`${sorted.length} reminder${sorted.length === 1 ? "" : "s"}`];
		if (overdueCount > 0) {
			summary.push(chalk.red(`${overdueCount} overdue`));
		}

		process.stdout.write(chalk.bold(`\n${listName}`) + chalk.dim(` (${summary.join(", ")})\n`));
		process.stdout.write(`${"─".repeat(listName.length + 2)}\n`);
	}

	for (const r of sorted) {
		process.stdout.write(formatReminderLine(r, opts));
	}
	process.stdout.write("\n");
}

function formatReminderLine(r: Reminder, opts?: OutputRemindersOpts): string {
	const checkbox = r.isCompleted ? chalk.green("✓") : chalk.dim("○");
	const title = r.isCompleted ? chalk.strikethrough(chalk.dim(r.title)) : r.title;

	const parts: string[] = [` ${checkbox} ${title}`];
	const badges: string[] = [];

	// Date
	if (r.dueDate) {
		const dateStr = colorDate(r.dueDate, opts?.context as "today" | "overdue" | undefined);
		if (dateStr) badges.push(dateStr);
	}

	// Recurring
	if (r.isRecurring) {
		badges.push(chalk.blue("↻"));
	}

	// Priority
	if (r.priority && r.priority !== "none") {
		const colors = { high: chalk.red, medium: chalk.yellow, low: chalk.blue };
		badges.push(
			colors[r.priority](r.priority === "high" ? "!!!" : r.priority === "medium" ? "!!" : "!"),
		);
	}

	// Flagged
	if (r.flagged) {
		badges.push(chalk.hex("#FF9500")("⚑"));
	}

	// Notes indicator
	if (r.notes) {
		if (verboseMode) {
			const preview = r.notes.length > 60 ? `${r.notes.substring(0, 57)}...` : r.notes;
			badges.push(chalk.dim(`📝 ${preview}`));
		} else {
			badges.push(chalk.dim("📝"));
		}
	}

	// Section (only in list context, not cross-list views)
	if (r.section) {
		badges.push(chalk.cyan(`[${r.section}]`));
	}

	// List name (for cross-list views like today, overdue, search)
	if (opts?.showList && r.listName) {
		badges.push(chalk.magenta(`[${r.listName}]`));
	}

	if (badges.length > 0) {
		parts.push(` ${badges.join("  ")}`);
	}

	return `${parts.join("")}\n`;
}

/** Format and output a list of sections with optional reminder counts */
export function outputSections(
	sections: Section[],
	listName: string,
	counts?: Map<string, number>,
): void {
	if (jsonMode) {
		outputSuccess(sections);
		return;
	}

	if (sections.length === 0) {
		process.stdout.write(`No sections found in "${listName}".\n`);
		return;
	}

	process.stdout.write(chalk.bold(`\nSections in "${listName}"\n`));
	process.stdout.write(`${"─".repeat(listName.length + 14)}\n`);

	for (const s of sections) {
		const count = counts?.get(s.displayName);
		const countStr = count !== undefined ? chalk.dim(` (${count})`) : "";
		process.stdout.write(` • ${s.displayName}${countStr}\n`);
	}
	process.stdout.write("\n");
}

/** Output a simple success message */
export function outputMessage(message: string, data?: Record<string, unknown>): void {
	if (jsonMode) {
		outputSuccess({ message, ...data });
		return;
	}
	process.stdout.write(`${chalk.green("✓")} ${message}\n`);
}
