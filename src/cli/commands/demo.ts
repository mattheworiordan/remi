import chalk from "chalk";
import { createList, createReminder, deleteList, listLists } from "../../core/eventkit.js";
import { assignToSection } from "../../core/membership.js";
import { createSection } from "../../core/reminderkit.js";
import { isJsonMode, outputMessage } from "../output.js";

const DEMO_LIST = "remi Demo";

function daysFromNow(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function demoCommand(opts: { cleanup?: boolean }): Promise<void> {
	if (opts.cleanup) {
		try {
			await deleteList(DEMO_LIST);
			outputMessage(`Deleted "${DEMO_LIST}"`);
		} catch {
			outputMessage(`"${DEMO_LIST}" not found — nothing to clean up`);
		}
		return;
	}

	// Check if demo list already exists
	const lists = await listLists();
	if (lists.some((l) => l.title === DEMO_LIST)) {
		if (!isJsonMode()) {
			process.stdout.write(
				chalk.yellow(
					`"${DEMO_LIST}" already exists. Run ${chalk.bold("remi demo --cleanup")} first.\n`,
				),
			);
		}
		return;
	}

	if (!isJsonMode()) {
		process.stdout.write(chalk.bold(`\nCreating "${DEMO_LIST}"...\n\n`));
	}

	// Create list
	await createList(DEMO_LIST);

	// Create sections
	const sections = ["This Week", "Upcoming", "Ideas"];
	for (const s of sections) {
		await createSection(DEMO_LIST, s);
	}

	// Add reminders with various features
	const items: Array<{
		title: string;
		section: string;
		due?: string;
		priority?: string;
		notes?: string;
		repeat?: string;
		repeatInterval?: number;
	}> = [
		// This Week
		{
			title: "Review pull requests",
			section: "This Week",
			due: daysFromNow(0), // today
			priority: "high",
		},
		{
			title: "Book dentist appointment",
			section: "This Week",
			due: daysFromNow(2),
		},
		{
			title: "Team standup",
			section: "This Week",
			due: daysFromNow(0), // today
			repeat: "DAILY",
			notes: "Zoom link in calendar",
		},
		{
			title: "Weekly grocery run",
			section: "This Week",
			due: daysFromNow(1),
			repeat: "WEEKLY",
		},
		// Upcoming
		{
			title: "Renew passport",
			section: "Upcoming",
			due: daysFromNow(16),
			priority: "high",
			notes: "Check gov.uk for processing times",
		},
		{
			title: "Plan birthday party",
			section: "Upcoming",
			due: daysFromNow(36),
		},
		{
			title: "Car service",
			section: "Upcoming",
			due: daysFromNow(24),
			repeat: "YEARLY",
		},
		// Ideas
		{
			title: "Learn to make sourdough bread",
			section: "Ideas",
		},
		{
			title: "Set up a home weather station",
			section: "Ideas",
		},
		{
			title: "Try the new ramen place on High Street",
			section: "Ideas",
			notes: "Heard it's great from Sarah",
		},
	];

	for (const item of items) {
		const createOpts: Parameters<typeof createReminder>[0] = {
			title: item.title,
			listName: DEMO_LIST,
			due: item.due,
			priority: item.priority,
			notes: item.notes,
		};
		if (item.repeat) {
			createOpts.rruleFreq = item.repeat;
			if (item.repeatInterval) createOpts.rruleInterval = item.repeatInterval;
		}
		await createReminder(createOpts);

		await assignToSection(DEMO_LIST, item.title, item.section);

		if (!isJsonMode()) {
			process.stdout.write(chalk.dim(`  + ${item.title}\n`));
		}
	}

	if (!isJsonMode()) {
		process.stdout.write(
			`\n${chalk.green("✓")} Demo list created with ${items.length} reminders and ${sections.length} sections.\n`,
		);
		process.stdout.write(chalk.dim(`\nTry these:\n`));
		process.stdout.write(chalk.dim(`  remi list demo\n`));
		process.stdout.write(chalk.dim(`  remi sections demo\n`));
		process.stdout.write(chalk.dim(`  remi complete demo "Book dentist appointment"\n`));
		process.stdout.write(
			chalk.dim(`  remi move demo "Learn to make sourdough bread" --to-section "This Week"\n`),
		);
		process.stdout.write(chalk.dim(`  remi demo --cleanup   (when done)\n\n`));
	} else {
		outputMessage(
			`Demo list created with ${items.length} reminders and ${sections.length} sections`,
		);
	}
}
