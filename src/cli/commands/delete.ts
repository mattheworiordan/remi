import { ErrorCode, RemiCommandError } from "../../core/errors.js";
import * as eventkit from "../../core/eventkit.js";
import { findReminderByTitle } from "../../core/lookup.js";
import { resolveListName } from "../../core/resolve.js";
import { isJsonMode, outputMessage } from "../output.js";

export async function deleteCommand(
	list: string,
	title: string,
	opts: { id?: string; confirm?: boolean },
): Promise<void> {
	if (!opts.confirm && !isJsonMode()) {
		throw new RemiCommandError(
			ErrorCode.INVALID_ARGUMENT,
			"Deletion requires --confirm flag",
			`Run: remi delete "${list}" "${title}" --confirm`,
		);
	}

	const listName = await resolveListName(list);
	const reminder = await findReminderByTitle(listName, title, opts);
	await eventkit.deleteReminder(reminder.id);
	outputMessage(`Deleted "${reminder.title}" from "${listName}"`);
}
