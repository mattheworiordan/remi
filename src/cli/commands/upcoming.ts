import { getReminders } from "../../core/eventkit.js";
import { outputReminders } from "../output.js";

export async function upcomingCommand(opts: { days?: string }): Promise<void> {
	const days = opts.days ? Number.parseInt(opts.days, 10) : 7;
	const reminders = await getReminders({ filter: "upcoming", days });
	outputReminders(reminders, `Due in next ${days} days`, {
		context: "upcoming",
		showList: true,
		sortByDate: true,
	});
}
