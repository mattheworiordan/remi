import { listSections } from "../../core/reminderkit.js";
import { resolveListName } from "../../core/resolve.js";
import { outputSections } from "../output.js";

export async function sectionsCommand(list: string): Promise<void> {
	const listName = await resolveListName(list);
	const sections = await listSections(listName);
	outputSections(sections, listName);
}
