import { ErrorCode, RemiCommandError } from "../../core/errors.js";
import * as eventkit from "../../core/eventkit.js";
import { findReminderByTitle } from "../../core/lookup.js";
import { isJsonMode, outputMessage } from "../output.js";

export async function deleteCommand(
	list: string,
	title: string,
	opts: { id?: string; confirm?: boolean },
): Promise<void> {
	// Require --confirm in interactive mode (JSON mode skips confirmation for agents)
	if (!opts.confirm && !isJsonMode()) {
		throw new RemiCommandError(
			ErrorCode.INVALID_ARGUMENT,
			"Deletion requires --confirm flag",
			`Run: remi delete "${list}" "${title}" --confirm`,
		);
	}

	const reminder = await findReminderByTitle(list, title, opts);
	await eventkit.deleteReminder(reminder.id);
	outputMessage(`Deleted "${reminder.title}" from "${list}"`);
}
