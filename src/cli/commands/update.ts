import { parseDate } from "../../core/dateparse.js";
import * as eventkit from "../../core/eventkit.js";
import { findReminderByTitle } from "../../core/lookup.js";
import { resolveListName } from "../../core/resolve.js";
import { outputMessage } from "../output.js";

export async function updateCommand(
	list: string,
	title: string,
	opts: { title?: string; due?: string; clearDue?: boolean; priority?: string; notes?: string },
): Promise<void> {
	const listName = await resolveListName(list);
	const reminder = await findReminderByTitle(listName, title);
	await eventkit.editReminder({
		id: reminder.id,
		title: opts.title,
		due: opts.due ? parseDate(opts.due) : undefined,
		clearDue: opts.clearDue,
		notes: opts.notes,
		priority: opts.priority,
	});
	outputMessage(`Updated "${reminder.title}" in "${listName}"`);
}
