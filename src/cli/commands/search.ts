import { searchReminders } from "../../core/eventkit.js";
import { outputReminders } from "../output.js";

export async function searchCommand(query: string): Promise<void> {
	const reminders = await searchReminders(query);
	outputReminders(reminders, `Search: "${query}"`);
}
