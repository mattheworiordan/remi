/**
 * Resolution token map manipulation.
 *
 * The token map is Apple's CRDT-style vector clock for field-level sync.
 * Each syncable field has a counter and modificationTime. When a field changes
 * locally, its counter must be incremented to tell remindd's sync engine
 * "this field has a local change that needs to be pushed to CloudKit".
 *
 * These are pure functions — no side effects, easy to unit test.
 */

import type { TokenMap } from "../types.js";

const MEMBERSHIP_FIELD = "membershipsOfRemindersInSectionsChecksum";

/**
 * Parse a token map JSON string into a TokenMap object.
 * Returns an empty map if the input is null/empty/invalid.
 */
export function parseTokenMap(json: string | null): TokenMap {
	if (!json || json.trim() === "") return {};
	try {
		return JSON.parse(json) as TokenMap;
	} catch {
		return {};
	}
}

/**
 * Increment the membership field counter in the token map and set modificationTime.
 * Returns a new TokenMap (does not mutate the input).
 */
export function incrementMembershipCounter(tokenMap: TokenMap, timestamp: number): TokenMap {
	const updated = { ...tokenMap };
	const existing = updated[MEMBERSHIP_FIELD];
	const currentCounter = existing?.counter ?? 0;

	updated[MEMBERSHIP_FIELD] = {
		counter: currentCounter + 1,
		modificationTime: timestamp,
	};

	return updated;
}

/**
 * Serialize a token map to a JSON string with sorted keys for consistency.
 */
export function serializeTokenMap(tokenMap: TokenMap): string {
	return JSON.stringify(tokenMap, Object.keys(tokenMap).sort());
}

/**
 * Get the current counter value for the membership field.
 */
export function getMembershipCounter(tokenMap: TokenMap): number {
	return tokenMap[MEMBERSHIP_FIELD]?.counter ?? 0;
}
