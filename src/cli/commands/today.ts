import { getReminders } from "../../core/eventkit.js";
import { outputReminders } from "../output.js";

export async function todayCommand(): Promise<void> {
	const reminders = await getReminders({ filter: "today" });
	outputReminders(reminders, "Due Today", {
		context: "today",
		showList: true,
		sortByDate: true,
	});
}
