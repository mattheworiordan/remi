import { parseDate } from "../../core/dateparse.js";
import { createReminder } from "../../core/eventkit.js";
import { assignToSection } from "../../core/membership.js";
import { parseRepeat } from "../../core/recurrence.js";
import { outputMessage } from "../output.js";

export async function addCommand(
	list: string,
	title: string,
	opts: {
		section?: string;
		due?: string;
		priority?: string;
		notes?: string;
		repeat?: string;
	},
): Promise<void> {
	const createOpts: Parameters<typeof createReminder>[0] = {
		title,
		listName: list,
		due: opts.due ? parseDate(opts.due) : undefined,
		priority: opts.priority,
		notes: opts.notes,
	};

	if (opts.repeat) {
		const rec = parseRepeat(opts.repeat);
		createOpts.rruleFreq = rec.rruleFreq;
		createOpts.rruleInterval = rec.rruleInterval;
		if (rec.rruleDays) createOpts.rruleDays = rec.rruleDays;
	}

	const id = await createReminder(createOpts);

	let warning: string | undefined;
	if (opts.section) {
		const result = await assignToSection(list, title, opts.section);
		warning = result.warning;
	}

	let msg = `Added "${title}" to "${list}"`;
	if (opts.repeat) msg += ` (repeats ${opts.repeat})`;
	if (opts.section) msg += ` in section "${opts.section}"`;
	if (warning) msg += ` (note: ${warning})`;
	outputMessage(msg, { id });
}
