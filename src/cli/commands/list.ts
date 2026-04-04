import { getReminders } from "../../core/eventkit.js";
import { getMemberships } from "../../core/membership.js";
import { listSections } from "../../core/reminderkit.js";
import { resolveListName } from "../../core/resolve.js";
import { outputReminders } from "../output.js";

export async function listCommand(
	name: string,
	opts: { section?: string; includeCompleted?: boolean },
): Promise<void> {
	const listName = await resolveListName(name);
	const filter = opts.includeCompleted ? "all" : "incomplete";
	const reminders = await getReminders({ list: listName, filter });

	// Try to enrich reminders with section info
	try {
		const [sections, memberships] = await Promise.all([
			listSections(listName),
			getMemberships(listName),
		]);

		if (sections.length > 0) {
			// Build lookup: memberID (dashed UUID) -> groupID
			const memberToGroup = new Map(
				memberships.memberships.map((m) => [m.reminderID, m.sectionID]),
			);

			// Build groupID -> sectionName lookup from sections + memberships
			const groupToSection = new Map<string, string>();
			// We need to map groupIDs to section names. Since we don't have
			// section UUIDs from ReminderKit, use the database to match them.
			// For now, use a simpler approach: query section identifiers via the DB
			const { dbFindSection } = await import("../../core/reminderkit.js");

			// Build the map by looking up each section's identifier
			for (const section of sections) {
				try {
					const dbSection = await dbFindSection(section.displayName, listName);
					// Convert hex identifier to dashed UUID
					const hex = dbSection.identifier;
					const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
					groupToSection.set(uuid, section.displayName);
				} catch {
					// Skip if can't find in DB
				}
			}

			// Assign section names to reminders
			for (const r of reminders) {
				const groupId = memberToGroup.get(r.id);
				if (groupId) {
					r.section = groupToSection.get(groupId);
				}
			}
		}
	} catch {
		// Section enrichment failed (no FDA, no section-helper, etc.)
		// Continue without section info — basic list still works
	}

	outputReminders(reminders, listName, {
		context: "list",
		sortByDate: true,
		groupBySections: true,
	});
}
