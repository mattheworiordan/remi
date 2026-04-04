/**
 * Name resolution — resolves user-provided list/section names to actual names
 * using fuzzy matching against the real data.
 */

import { listLists } from "./eventkit.js";
import { fuzzyFind } from "./fuzzy.js";
import { listSections } from "./reminderkit.js";

/**
 * Resolve a user-provided list name to the actual list name.
 * Supports case-insensitive and substring matching.
 */
export async function resolveListName(query: string): Promise<string> {
	const lists = await listLists();
	const match = fuzzyFind(query, lists, (l) => l.title, "list");
	return match.title;
}

/**
 * Resolve a user-provided section name to the actual section name.
 */
export async function resolveSectionName(listName: string, sectionQuery: string): Promise<string> {
	const sections = await listSections(listName);
	const match = fuzzyFind(sectionQuery, sections, (s) => s.displayName, "section");
	return match.displayName;
}
