import { deleteSection } from "../../core/reminderkit.js";
import { resolveListName, resolveSectionName } from "../../core/resolve.js";
import { outputMessage } from "../output.js";

export async function deleteSectionCommand(list: string, name: string): Promise<void> {
	const listName = await resolveListName(list);
	const sectionName = await resolveSectionName(listName, name);
	await deleteSection(listName, sectionName);
	outputMessage(`Deleted section "${sectionName}" from "${listName}"`);
}
