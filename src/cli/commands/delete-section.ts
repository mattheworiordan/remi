import { deleteSection } from "../../core/reminderkit.js";
import { outputMessage } from "../output.js";

export async function deleteSectionCommand(list: string, name: string): Promise<void> {
	await deleteSection(list, name);
	outputMessage(`Deleted section "${name}" from "${list}"`);
}
