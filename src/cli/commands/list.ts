import { getReminders } from "../../core/eventkit.js";
import { outputReminders } from "../output.js";

export async function listCommand(
	name: string,
	opts: { section?: string; includeCompleted?: boolean },
): Promise<void> {
	const filter = opts.includeCompleted ? "all" : "incomplete";
	const reminders = await getReminders({ list: name, filter });
	// Section filtering will be wired in Phase 3
	outputReminders(reminders, name);
}
