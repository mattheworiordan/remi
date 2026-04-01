/**
 * Reminder lookup by title within a list.
 *
 * Resolves a human-friendly title to a reminder ID for operations like
 * complete, delete, update, and move.
 */

import type { Reminder } from "../types.js";
import { ErrorCode, RemiCommandError } from "./errors.js";
import { getReminders } from "./eventkit.js";

export async function findReminderByTitle(
	listName: string,
	title: string,
	opts?: { id?: string },
): Promise<Reminder> {
	// If --id flag is provided, use that directly
	if (opts?.id) {
		const idPrefix = opts.id.toUpperCase();
		const reminders = await getReminders({ list: listName, filter: "all" });
		const match = reminders.find((r) => r.id.toUpperCase().startsWith(idPrefix));
		if (!match) {
			throw new RemiCommandError(
				ErrorCode.REMINDER_NOT_FOUND,
				`No reminder found with ID starting with "${opts.id}" in "${listName}"`,
			);
		}
		return match;
	}

	// Search by title (case-insensitive exact match)
	const reminders = await getReminders({ list: listName, filter: "all" });
	const matches = reminders.filter((r) => r.title.toLowerCase() === title.toLowerCase());

	if (matches.length === 0) {
		throw new RemiCommandError(
			ErrorCode.REMINDER_NOT_FOUND,
			`No reminder titled "${title}" found in "${listName}"`,
			`Use "remi list '${listName}'" to see available reminders`,
		);
	}

	if (matches.length > 1) {
		const ids = matches.map((r) => `  ${r.id.substring(0, 8)} - "${r.title}"`).join("\n");
		throw new RemiCommandError(
			ErrorCode.AMBIGUOUS_REMINDER,
			`Multiple reminders titled "${title}" found in "${listName}":\n${ids}`,
			"Use --id <prefix> to specify which one",
		);
	}

	return matches[0];
}
