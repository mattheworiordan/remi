import { createSection } from "../../core/reminderkit.js";
import { resolveListName } from "../../core/resolve.js";
import { outputMessage } from "../output.js";

export async function createSectionCommand(list: string, name: string): Promise<void> {
	const listName = await resolveListName(list);
	await createSection(listName, name);
	outputMessage(`Created section "${name}" in "${listName}"`);
}
