/**
 * Section membership orchestration.
 *
 * All database operations are routed through the compiled section-helper binary
 * (which has its own Info.plist for macOS permissions). The binary handles the
 * atomic transaction internally: write data + checksum + token map in one go.
 *
 * Flow:
 * 1. Read current memberships via binary
 * 2. Modify in TypeScript (add/remove entries)
 * 3. Send updated JSON to binary for atomic write + sync trigger
 */

import type { MembershipData } from "../types.js";
import {
	dbFindReminder,
	dbFindSection,
	dbReadMemberships,
	dbWriteMembershipSync,
} from "./reminderkit.js";

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

/** Convert hex UUID (32 chars) to dashed format (8-4-4-4-12) */
function hexToUuid(hex: string): string {
	const h = hex.toUpperCase();
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Core Data timestamp: seconds since 2001-01-01 00:00:00 UTC */
function coreDataTimestamp(): number {
	return Date.now() / 1000 - 978307200;
}

/**
 * Assign a reminder to a section within its list, with iCloud sync.
 * Idempotent: assigning to a section it's already in returns success.
 */
export async function assignToSection(
	listName: string,
	reminderTitle: string,
	sectionName: string,
): Promise<{ warning?: string }> {
	const reminder = await dbFindReminder(reminderTitle, listName);
	const section = await dbFindSection(sectionName, listName);

	const memberUuid = hexToUuid(reminder.identifier);
	const sectionUuid = hexToUuid(section.identifier);
	const timestamp = coreDataTimestamp();

	// Read current membership data
	const currentData = await dbReadMemberships(listName);
	let membership: MembershipBlob;

	if (currentData && currentData.trim() !== "") {
		membership = JSON.parse(currentData) as MembershipBlob;

		// Idempotent: already assigned to this section
		const existing = membership.memberships.find(
			(m) => m.memberID === memberUuid && m.groupID === sectionUuid,
		);
		if (existing) return {};

		// Remove any existing assignment (move semantics)
		membership.memberships = membership.memberships.filter((m) => m.memberID !== memberUuid);
		membership.memberships.push({
			memberID: memberUuid,
			groupID: sectionUuid,
			modifiedOn: timestamp,
		});
	} else {
		membership = {
			minimumSupportedVersion: 20230430,
			memberships: [{ memberID: memberUuid, groupID: sectionUuid, modifiedOn: timestamp }],
		};
	}

	// Atomic write + sync via compiled binary
	const warning = await dbWriteMembershipSync(listName, JSON.stringify(membership));
	return { warning };
}

/**
 * Remove a reminder from its current section.
 */
export async function removeFromSection(
	listName: string,
	reminderTitle: string,
): Promise<{ warning?: string }> {
	const reminder = await dbFindReminder(reminderTitle, listName);
	const memberUuid = hexToUuid(reminder.identifier);

	const currentData = await dbReadMemberships(listName);
	if (!currentData || currentData.trim() === "") return {};

	const membership = JSON.parse(currentData) as MembershipBlob;
	const originalLength = membership.memberships.length;
	membership.memberships = membership.memberships.filter((m) => m.memberID !== memberUuid);

	if (membership.memberships.length === originalLength) return {};

	const warning = await dbWriteMembershipSync(listName, JSON.stringify(membership));
	return { warning };
}

/**
 * Get all membership entries for a list.
 */
export async function getMemberships(listName: string): Promise<MembershipData> {
	const data = await dbReadMemberships(listName);
	if (!data || data.trim() === "") return { memberships: [] };

	const blob = JSON.parse(data) as MembershipBlob;
	return {
		memberships: blob.memberships.map((m) => ({
			reminderID: m.memberID,
			sectionID: m.groupID,
		})),
	};
}
