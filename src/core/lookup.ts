/**
 * Reminder lookup by title within a list.
 *
 * Resolves a human-friendly title to a reminder ID for operations like
 * complete, delete, update, and move. Supports fuzzy substring matching.
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

	const reminders = await getReminders({ list: listName, filter: "all" });
	const q = title.toLowerCase();

	// 1. Exact match
	const exact = reminders.find((r) => r.title === title);
	if (exact) return exact;

	// 2. Case-insensitive exact match
	const ciExact = reminders.find((r) => r.title.toLowerCase() === q);
	if (ciExact) return ciExact;

	// 3. Substring match
	const substringMatches = reminders.filter((r) => r.title.toLowerCase().includes(q));

	if (substringMatches.length === 1) {
		return substringMatches[0];
	}

	if (substringMatches.length > 1) {
		const names = substringMatches.map((r) => `  - "${r.title}"`).join("\n");
		throw new RemiCommandError(
			ErrorCode.AMBIGUOUS_REMINDER,
			`"${title}" matches multiple reminders in "${listName}":\n${names}`,
			"Be more specific, or use --id <prefix>",
		);
	}

	// No match
	throw new RemiCommandError(
		ErrorCode.REMINDER_NOT_FOUND,
		`No reminder matching "${title}" in "${listName}"`,
		`Use "remi list '${listName}'" to see available reminders`,
	);
}
