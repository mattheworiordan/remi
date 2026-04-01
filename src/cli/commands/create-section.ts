import { createSection } from "../../core/reminderkit.js";
import { outputMessage } from "../output.js";

export async function createSectionCommand(list: string, name: string): Promise<void> {
	await createSection(list, name);
	outputMessage(`Created section "${name}" in "${list}"`);
}
