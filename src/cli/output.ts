import chalk from "chalk";
import type { RemiError, RemiResult, Reminder, ReminderList, Section } from "../types.js";

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
	jsonMode = enabled;
}

export function isJsonMode(): boolean {
	return jsonMode;
}

/** Output a successful result */
export function outputSuccess<T>(data: T): void {
	if (jsonMode) {
		const result: RemiResult<T> = { success: true, data };
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} else {
		// Human-readable output depends on data type — handled by specific formatters
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
	const header = `${"Name".padEnd(maxNameLen)}  Count  Overdue`;
	process.stdout.write(`${chalk.bold(header)}\n`);
	process.stdout.write(`${"─".repeat(header.length)}\n`);

	for (const list of lists) {
		const overdue =
			list.overdueCount > 0 ? chalk.red(String(list.overdueCount)) : String(list.overdueCount);
		process.stdout.write(
			`${list.title.padEnd(maxNameLen)}  ${String(list.reminderCount).padStart(5)}  ${String(overdue).padStart(7)}\n`,
		);
	}
}

/** Format and output a list of reminders */
export function outputReminders(reminders: Reminder[], listName?: string): void {
	if (jsonMode) {
		outputSuccess(reminders);
		return;
	}

	if (reminders.length === 0) {
		const ctx = listName ? ` in "${listName}"` : "";
		process.stdout.write(`No reminders found${ctx}.\n`);
		return;
	}

	if (listName) {
		process.stdout.write(chalk.bold(`\n${listName}\n`));
		process.stdout.write(`${"─".repeat(listName.length)}\n`);
	}

	for (const r of reminders) {
		const checkbox = r.isCompleted ? chalk.green("✓") : chalk.dim("○");
		const title = r.isCompleted ? chalk.strikethrough(r.title) : r.title;
		const parts = [` ${checkbox} ${title}`];

		if (r.dueDate) {
			parts.push(chalk.dim(` (due: ${r.dueDate})`));
		}
		if (r.priority && r.priority !== "none") {
			const colors = { high: chalk.red, medium: chalk.yellow, low: chalk.blue };
			parts.push(colors[r.priority](`[${r.priority}]`));
		}
		if (r.section) {
			parts.push(chalk.cyan(`[${r.section}]`));
		}

		process.stdout.write(`${parts.join(" ")}\n`);
	}
	process.stdout.write("\n");
}

/** Format and output a list of sections */
export function outputSections(sections: Section[], listName: string): void {
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
		process.stdout.write(` • ${s.displayName}\n`);
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
