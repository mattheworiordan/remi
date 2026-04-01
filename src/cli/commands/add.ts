import { createReminder } from "../../core/eventkit.js";
import { assignToSection } from "../../core/membership.js";
import { outputMessage } from "../output.js";

export async function addCommand(
	list: string,
	title: string,
	opts: { section?: string; due?: string; priority?: string; notes?: string },
): Promise<void> {
	const id = await createReminder({
		title,
		listName: list,
		due: opts.due,
		priority: opts.priority,
		notes: opts.notes,
	});

	let warning: string | undefined;
	if (opts.section) {
		const result = await assignToSection(list, title, opts.section);
		warning = result.warning;
	}

	let msg = `Added "${title}" to "${list}"`;
	if (opts.section) msg += ` in section "${opts.section}"`;
	if (warning) msg += ` (note: ${warning})`;
	outputMessage(msg, { id });
}
