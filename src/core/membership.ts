/**
 * Section membership orchestration.
 *
 * Handles the 4-step sync flow for assigning reminders to sections:
 * 1. Read/update membership JSON
 * 2. Compute SHA-512 checksum
 * 3. Update resolution token map (CRDT vector clock)
 * 4. Write all three to SQLite in a single atomic transaction
 * 5. Trigger CloudKit sync via EventKit
 *
 * Steps 1-4 happen in TypeScript with better-sqlite3 (proper transactions).
 * Step 5 uses the compiled section-helper binary (EventKit trigger).
 */

import type { MembershipData } from "../types.js";
import { computeMembershipChecksum } from "./checksum.js";
import { triggerSync } from "./reminderkit.js";
import {
	coreDataTimestamp,
	findListPk,
	findReminderIdentifier,
	findSectionIdentifier,
	hexToUuid,
	readMembershipData,
	readTokenMap,
	writeMembershipSync,
} from "./sqlite.js";
import { incrementMembershipCounter, parseTokenMap, serializeTokenMap } from "./tokenmap.js";

/** Membership entry format matching Apple's database schema */
interface MembershipEntry {
	memberID: string;
	groupID: string;
	modifiedOn: number;
}

interface MembershipBlob {
	minimumSupportedVersion: number;
	memberships: MembershipEntry[];
}

/**
 * Assign a reminder to a section within its list, with iCloud sync.
 *
 * This is idempotent: assigning a reminder to a section it's already in returns success.
 *
 * Returns a warning string if sync trigger failed (non-fatal — data is written).
 */
export async function assignToSection(
	listName: string,
	reminderTitle: string,
	sectionName: string,
): Promise<{ warning?: string }> {
	const listPk = findListPk(listName);
	const reminder = findReminderIdentifier(reminderTitle, listName);
	const section = findSectionIdentifier(sectionName, listName);

	const memberUuid = hexToUuid(reminder.identifier);
	const sectionUuid = hexToUuid(section.identifier);
	const timestamp = coreDataTimestamp();

	// Read current membership data
	const currentData = readMembershipData(listPk);
	let membership: MembershipBlob;

	if (currentData && currentData.trim() !== "") {
		membership = JSON.parse(currentData) as MembershipBlob;

		// Idempotent: check if already assigned to this section
		const existing = membership.memberships.find(
			(m) => m.memberID === memberUuid && m.groupID === sectionUuid,
		);
		if (existing) {
			return {};
		}

		// Remove any existing assignment for this reminder (move, not add)
		membership.memberships = membership.memberships.filter((m) => m.memberID !== memberUuid);

		membership.memberships.push({
			memberID: memberUuid,
			groupID: sectionUuid,
			modifiedOn: timestamp,
		});
	} else {
		membership = {
			minimumSupportedVersion: 20230430,
			memberships: [
				{
					memberID: memberUuid,
					groupID: sectionUuid,
					modifiedOn: timestamp,
				},
			],
		};
	}

	// Serialize membership data (consistent key order for checksum)
	const membershipJson = JSON.stringify(membership);

	// Compute checksum
	const checksumHex = computeMembershipChecksum(membershipJson);

	// Update token map
	const currentTokenMapJson = readTokenMap(listPk);
	const tokenMap = parseTokenMap(currentTokenMapJson);
	const updatedTokenMap = incrementMembershipCounter(tokenMap, timestamp);
	const tokenMapJson = serializeTokenMap(updatedTokenMap);

	// Write all three in a single atomic transaction
	writeMembershipSync(listPk, membershipJson, checksumHex, tokenMapJson);

	// Trigger CloudKit sync
	const warning = await triggerSync(listName);
	return { warning };
}

/**
 * Remove a reminder from its current section.
 *
 * Returns a warning string if sync trigger failed (non-fatal).
 */
export async function removeFromSection(
	listName: string,
	reminderTitle: string,
): Promise<{ warning?: string }> {
	const listPk = findListPk(listName);
	const reminder = findReminderIdentifier(reminderTitle, listName);
	const memberUuid = hexToUuid(reminder.identifier);

	const currentData = readMembershipData(listPk);
	if (!currentData || currentData.trim() === "") {
		return {}; // No memberships, nothing to remove
	}

	const membership = JSON.parse(currentData) as MembershipBlob;
	const originalLength = membership.memberships.length;
	membership.memberships = membership.memberships.filter((m) => m.memberID !== memberUuid);

	if (membership.memberships.length === originalLength) {
		return {}; // Wasn't assigned to any section
	}

	const timestamp = coreDataTimestamp();
	const membershipJson = JSON.stringify(membership);
	const checksumHex = computeMembershipChecksum(membershipJson);

	const currentTokenMapJson = readTokenMap(listPk);
	const tokenMap = parseTokenMap(currentTokenMapJson);
	const updatedTokenMap = incrementMembershipCounter(tokenMap, timestamp);
	const tokenMapJson = serializeTokenMap(updatedTokenMap);

	writeMembershipSync(listPk, membershipJson, checksumHex, tokenMapJson);

	const warning = await triggerSync(listName);
	return { warning };
}

/**
 * Get all membership entries for a list. Used by `remi list --section` filter.
 */
export function getMemberships(listName: string): MembershipData {
	const listPk = findListPk(listName);
	const data = readMembershipData(listPk);

	if (!data || data.trim() === "") {
		return { memberships: [] };
	}

	const blob = JSON.parse(data) as MembershipBlob;
	return {
		memberships: blob.memberships.map((m) => ({
			reminderID: m.memberID,
			sectionID: m.groupID,
		})),
	};
}
