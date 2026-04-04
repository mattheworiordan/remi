/**
 * Fuzzy matching for list and section names.
 *
 * Makes the CLI forgiving — users don't need exact names.
 * Matching priority: exact > case-insensitive exact > substring > no match.
 * If multiple substring matches, returns all so the caller can ask the user.
 */

import { ErrorCode, RemiCommandError } from "./errors.js";

export interface FuzzyMatch<T> {
	item: T;
	name: string;
}

/**
 * Find the best match for a query among a list of named items.
 * Returns the single best match, or throws with suggestions if ambiguous.
 */
export function fuzzyFind<T>(
	query: string,
	items: T[],
	getName: (item: T) => string,
	itemType: string,
): T {
	if (items.length === 0) {
		throw new RemiCommandError(ErrorCode.LIST_NOT_FOUND, `No ${itemType}s found`);
	}

	const q = query.toLowerCase();

	// 1. Exact match
	const exact = items.find((item) => getName(item) === query);
	if (exact) return exact;

	// 2. Case-insensitive exact match
	const ciExact = items.find((item) => getName(item).toLowerCase() === q);
	if (ciExact) return ciExact;

	// 3. Substring match (case-insensitive)
	const substringMatches = items.filter((item) => getName(item).toLowerCase().includes(q));

	if (substringMatches.length === 1) {
		return substringMatches[0];
	}

	if (substringMatches.length > 1) {
		const names = substringMatches.map((item) => `  - ${getName(item)}`).join("\n");
		throw new RemiCommandError(
			ErrorCode.AMBIGUOUS_REMINDER,
			`"${query}" matches multiple ${itemType}s:\n${names}`,
			"Be more specific, or use the full name",
		);
	}

	// 4. No match — suggest closest
	const allNames = items.map((item) => `  - ${getName(item)}`).join("\n");
	throw new RemiCommandError(
		ErrorCode.LIST_NOT_FOUND,
		`No ${itemType} matching "${query}"`,
		`Available ${itemType}s:\n${allNames}`,
	);
}
