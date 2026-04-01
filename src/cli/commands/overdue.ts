import { getReminders } from "../../core/eventkit.js";
import { outputReminders } from "../output.js";

export async function overdueCommand(): Promise<void> {
	const reminders = await getReminders({ filter: "overdue" });
	outputReminders(reminders, "Overdue", {
		context: "overdue",
		showList: true,
		sortByDate: true,
	});
}
