import * as eventkit from "../../core/eventkit.js";
import { findReminderByTitle } from "../../core/lookup.js";
import { outputMessage } from "../output.js";

export async function completeCommand(
	list: string,
	title: string,
	opts: { id?: string },
): Promise<void> {
	const reminder = await findReminderByTitle(list, title, opts);
	await eventkit.completeReminder(reminder.id);
	outputMessage(`Completed "${reminder.title}" in "${list}"`);
}
