import { createReminder } from "../../core/eventkit.js";
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

	// Section assignment will be wired in Phase 3
	if (opts.section) {
		// TODO: Phase 3 — assign to section after creation
	}

	outputMessage(`Added "${title}" to "${list}"`, { id });
}
