#!/usr/bin/env node

import { Command } from "commander";
import { RemiCommandError } from "../core/errors.js";
import { outputError, setJsonMode } from "./output.js";

const program = new Command();

program
	.name("remi")
	.description("Fast, reliable CLI for Apple Reminders with section support and iCloud sync")
	.version("0.1.0")
	.option("--json", "Output in JSON format for machine consumption")
	.hook("preAction", (thisCommand) => {
		const opts = thisCommand.opts();
		if (opts.json) {
			setJsonMode(true);
		}
	});

// -- List Management --

program
	.command("lists")
	.alias("ls")
	.description("List all reminder lists")
	.action(async () => {
		const { listsCommand } = await import("./commands/lists.js");
		await listsCommand();
	});

program
	.command("list <name>")
	.description("Show contents of a reminder list")
	.option("--section <section>", "Filter by section")
	.option("--include-completed", "Include completed reminders")
	.action(async (name: string, opts) => {
		const { listCommand } = await import("./commands/list.js");
		await listCommand(name, opts);
	});

program
	.command("create-list <name>")
	.description("Create a new reminder list")
	.action(async (name: string) => {
		const { createListCommand } = await import("./commands/create-list.js");
		await createListCommand(name);
	});

program
	.command("delete-list <name>")
	.description("Delete a reminder list")
	.option("--confirm", "Confirm deletion (required in interactive mode)")
	.action(async (name: string, opts) => {
		const { deleteListCommand } = await import("./commands/delete-list.js");
		await deleteListCommand(name, opts);
	});

// -- Reminder Operations --

program
	.command("add <list> <title>")
	.description("Add a reminder to a list")
	.option("--section <section>", "Add to a specific section")
	.option("--due <date>", "Due date (YYYY-MM-DD or YYYY-MM-DD HH:mm)")
	.option("--priority <level>", "Priority: none, low, medium, high", "none")
	.option("--notes <text>", "Reminder notes")
	.action(async (list: string, title: string, opts) => {
		const { addCommand } = await import("./commands/add.js");
		await addCommand(list, title, opts);
	});

program
	.command("complete <list> <title>")
	.alias("done")
	.description("Mark a reminder as complete")
	.option("--id <id>", "Match by reminder ID instead of title")
	.action(async (list: string, title: string, opts) => {
		const { completeCommand } = await import("./commands/complete.js");
		await completeCommand(list, title, opts);
	});

program
	.command("delete <list> <title>")
	.alias("rm")
	.description("Delete a reminder")
	.option("--id <id>", "Match by reminder ID instead of title")
	.option("--confirm", "Confirm deletion (required in interactive mode)")
	.action(async (list: string, title: string, opts) => {
		const { deleteCommand } = await import("./commands/delete.js");
		await deleteCommand(list, title, opts);
	});

program
	.command("update <list> <title>")
	.description("Update a reminder")
	.option("--title <newTitle>", "New title")
	.option("--due <date>", "New due date")
	.option("--clear-due", "Remove due date")
	.option("--priority <level>", "New priority: none, low, medium, high")
	.option("--notes <text>", "New notes")
	.action(async (list: string, title: string, opts) => {
		const { updateCommand } = await import("./commands/update.js");
		await updateCommand(list, title, opts);
	});

// -- Section Operations --

program
	.command("sections <list>")
	.description("List sections in a reminder list")
	.action(async (list: string) => {
		const { sectionsCommand } = await import("./commands/sections.js");
		await sectionsCommand(list);
	});

program
	.command("create-section <list> <name>")
	.description("Create a section in a reminder list")
	.action(async (list: string, name: string) => {
		const { createSectionCommand } = await import("./commands/create-section.js");
		await createSectionCommand(list, name);
	});

program
	.command("delete-section <list> <name>")
	.description("Delete a section from a reminder list")
	.action(async (list: string, name: string) => {
		const { deleteSectionCommand } = await import("./commands/delete-section.js");
		await deleteSectionCommand(list, name);
	});

program
	.command("move <list> <title>")
	.description("Move a reminder to a different section")
	.requiredOption("--to-section <section>", "Target section name")
	.action(async (list: string, title: string, opts) => {
		const { moveCommand } = await import("./commands/move.js");
		await moveCommand(list, title, opts);
	});

// -- Query and Search --

program
	.command("search <query>")
	.description("Search reminders across all lists")
	.action(async (query: string) => {
		const { searchCommand } = await import("./commands/search.js");
		await searchCommand(query);
	});

program
	.command("today")
	.description("Show reminders due today")
	.action(async () => {
		const { todayCommand } = await import("./commands/today.js");
		await todayCommand();
	});

program
	.command("upcoming")
	.description("Show upcoming reminders")
	.option("--days <n>", "Number of days to look ahead", "7")
	.action(async (opts) => {
		const { upcomingCommand } = await import("./commands/upcoming.js");
		await upcomingCommand(opts);
	});

program
	.command("overdue")
	.description("Show overdue reminders")
	.action(async () => {
		const { overdueCommand } = await import("./commands/overdue.js");
		await overdueCommand();
	});

// -- Diagnostics --

program
	.command("doctor")
	.description("Check system health and diagnostics")
	.option("--sync", "Verify sync status")
	.option("--db", "Show database location and stats")
	.action(async (opts) => {
		const { doctorCommand } = await import("./commands/doctor.js");
		await doctorCommand(opts);
	});

// -- Error handling --

async function main(): Promise<void> {
	try {
		await program.parseAsync(process.argv);
	} catch (err) {
		if (err instanceof RemiCommandError) {
			outputError(err.toRemiError());
			process.exit(1);
		}
		// Unknown error
		const message = err instanceof Error ? err.message : String(err);
		outputError({ code: "UNKNOWN", message });
		process.exit(1);
	}
}

main();
