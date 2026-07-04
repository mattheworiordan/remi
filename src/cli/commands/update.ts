import { parseDate } from "../../core/dateparse.js";
import * as eventkit from "../../core/eventkit.js";
import { findReminderByTitle } from "../../core/lookup.js";
import { parseRepeat } from "../../core/recurrence.js";
import { resolveListName } from "../../core/resolve.js";
import { outputMessage } from "../output.js";

export async function updateCommand(
	list: string,
	title: string,
	opts: {
		title?: string;
		due?: string;
		clearDue?: boolean;
		priority?: string;
		notes?: string;
		repeat?: string;
		clearRepeat?: boolean;
	},
): Promise<void> {
	const listName = await resolveListName(list);
	const reminder = await findReminderByTitle(listName, title);
	const editOpts: eventkit.EditReminderOptions = {
		id: reminder.id,
		title: opts.title,
		due: opts.due ? parseDate(opts.due) : undefined,
		clearDue: opts.clearDue,
		notes: opts.notes,
		priority: opts.priority,
		clearRepeat: opts.clearRepeat,
	};
	if (opts.repeat) {
		const rec = parseRepeat(opts.repeat);
		editOpts.rruleFreq = rec.rruleFreq;
		editOpts.rruleInterval = rec.rruleInterval;
		if (rec.rruleDays) editOpts.rruleDays = rec.rruleDays;
	}
	await eventkit.editReminder(editOpts);
	outputMessage(`Updated "${reminder.title}" in "${listName}"`);
}
