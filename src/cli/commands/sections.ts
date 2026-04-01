import { listSections } from "../../core/reminderkit.js";
import { outputSections } from "../output.js";

export async function sectionsCommand(list: string): Promise<void> {
	const sections = await listSections(list);
	outputSections(sections, list);
}
