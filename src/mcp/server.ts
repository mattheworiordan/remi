#!/usr/bin/env node
/**
 * remi MCP Server — Apple Reminders management for AI agents.
 *
 * Exposes remi's functionality as MCP tools over stdio.
 * Agents get structured access to reminders, sections, and iCloud sync
 * without needing shell access.
 *
 * Usage:
 *   remi --mcp              (via CLI)
 *   node dist/mcp/server.js (direct)
 *
 * Configure in Claude Desktop:
 *   {
 *     "mcpServers": {
 *       "remi": {
 *         "command": "remi",
 *         "args": ["--mcp"]
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseDate } from "../core/dateparse.js";
import * as eventkit from "../core/eventkit.js";
import { findReminderByTitle } from "../core/lookup.js";
import { assignToSection, getMemberships, removeFromSection } from "../core/membership.js";
import { parseRepeat } from "../core/recurrence.js";
import { createSection, deleteSection, listSections } from "../core/reminderkit.js";
import { resolveListName, resolveSectionName } from "../core/resolve.js";

const server = new McpServer({
	name: "remi",
	version: "0.1.0",
});

// -- List operations --

server.tool("remi_lists", "List all reminder lists with counts", {}, async () => {
	const lists = await eventkit.listLists();
	return { content: [{ type: "text", text: JSON.stringify(lists, null, 2) }] };
});

server.tool(
	"remi_list",
	"Show reminders in a list (supports fuzzy name matching)",
	{
		list: z
			.string()
			.describe("List name (fuzzy match: 'groceries' finds 'Groceries / Shopping List')"),
		includeCompleted: z.boolean().optional().describe("Include completed reminders"),
	},
	async ({ list, includeCompleted }) => {
		const listName = await resolveListName(list);
		const filter = includeCompleted ? "all" : "incomplete";
		const reminders = await eventkit.getReminders({ list: listName, filter });
		return { content: [{ type: "text", text: JSON.stringify(reminders, null, 2) }] };
	},
);

server.tool(
	"remi_create_list",
	"Create a new reminder list (idempotent)",
	{
		name: z.string().describe("Name for the new list"),
	},
	async ({ name }) => {
		const id = await eventkit.createList(name);
		return { content: [{ type: "text", text: JSON.stringify({ id, name }) }] };
	},
);

server.tool(
	"remi_delete_list",
	"Delete a reminder list",
	{
		list: z.string().describe("List name to delete (fuzzy match)"),
	},
	async ({ list }) => {
		const listName = await resolveListName(list);
		await eventkit.deleteList(listName);
		return { content: [{ type: "text", text: `Deleted list "${listName}"` }] };
	},
);

// -- Reminder operations --

server.tool(
	"remi_add",
	"Add a reminder to a list with optional section, due date, priority, recurrence",
	{
		list: z.string().describe("List name (fuzzy match)"),
		title: z.string().describe("Reminder title"),
		section: z.string().optional().describe("Section name (fuzzy match)"),
		due: z
			.string()
			.optional()
			.describe("Due date: YYYY-MM-DD or natural language ('tomorrow', 'next friday')"),
		priority: z.enum(["none", "low", "medium", "high"]).optional().describe("Priority level"),
		notes: z.string().optional().describe("Reminder notes"),
		repeat: z
			.string()
			.optional()
			.describe("Recurrence: 'daily', 'weekly', 'every 2 weeks', 'monthly'"),
	},
	async ({ list, title, section, due, priority, notes, repeat }) => {
		const listName = await resolveListName(list);
		const sectionName = section ? await resolveSectionName(listName, section) : undefined;

		const createOpts: Parameters<typeof eventkit.createReminder>[0] = {
			title,
			listName,
			due: due ? parseDate(due) : undefined,
			priority,
			notes,
		};

		if (repeat) {
			const rec = parseRepeat(repeat);
			createOpts.rruleFreq = rec.rruleFreq;
			createOpts.rruleInterval = rec.rruleInterval;
			if (rec.rruleDays) createOpts.rruleDays = rec.rruleDays;
		}

		const id = await eventkit.createReminder(createOpts);

		if (sectionName) {
			await assignToSection(listName, title, sectionName);
		}

		return {
			content: [
				{ type: "text", text: JSON.stringify({ id, title, list: listName, section: sectionName }) },
			],
		};
	},
);

server.tool(
	"remi_complete",
	"Mark a reminder as complete (supports fuzzy title matching)",
	{
		list: z.string().describe("List name (fuzzy match)"),
		title: z.string().describe("Reminder title (fuzzy match: 'sour' finds 'sourdough bread')"),
	},
	async ({ list, title }) => {
		const listName = await resolveListName(list);
		const reminder = await findReminderByTitle(listName, title);
		await eventkit.completeReminder(reminder.id);
		return { content: [{ type: "text", text: `Completed "${reminder.title}"` }] };
	},
);

server.tool(
	"remi_delete",
	"Delete a reminder",
	{
		list: z.string().describe("List name (fuzzy match)"),
		title: z.string().describe("Reminder title (fuzzy match)"),
	},
	async ({ list, title }) => {
		const listName = await resolveListName(list);
		const reminder = await findReminderByTitle(listName, title);
		await eventkit.deleteReminder(reminder.id);
		return { content: [{ type: "text", text: `Deleted "${reminder.title}"` }] };
	},
);

server.tool(
	"remi_update",
	"Update a reminder's properties",
	{
		list: z.string().describe("List name (fuzzy match)"),
		title: z.string().describe("Reminder title to find (fuzzy match)"),
		newTitle: z.string().optional().describe("New title"),
		due: z.string().optional().describe("New due date"),
		clearDue: z.boolean().optional().describe("Remove the due date"),
		priority: z.enum(["none", "low", "medium", "high"]).optional().describe("New priority"),
		notes: z.string().optional().describe("New notes"),
	},
	async ({ list, title, newTitle, due, clearDue, priority, notes }) => {
		const listName = await resolveListName(list);
		const reminder = await findReminderByTitle(listName, title);
		await eventkit.editReminder({
			id: reminder.id,
			title: newTitle,
			due: due ? parseDate(due) : undefined,
			clearDue,
			priority,
			notes,
		});
		return { content: [{ type: "text", text: `Updated "${reminder.title}"` }] };
	},
);

// -- Section operations --

server.tool(
	"remi_sections",
	"List sections in a reminder list",
	{
		list: z.string().describe("List name (fuzzy match)"),
	},
	async ({ list }) => {
		const listName = await resolveListName(list);
		const sections = await listSections(listName);
		return { content: [{ type: "text", text: JSON.stringify(sections, null, 2) }] };
	},
);

server.tool(
	"remi_create_section",
	"Create a section in a list (idempotent)",
	{
		list: z.string().describe("List name (fuzzy match)"),
		name: z.string().describe("Section name"),
	},
	async ({ list, name }) => {
		const listName = await resolveListName(list);
		await createSection(listName, name);
		return { content: [{ type: "text", text: `Created section "${name}" in "${listName}"` }] };
	},
);

server.tool(
	"remi_delete_section",
	"Delete a section from a list",
	{
		list: z.string().describe("List name (fuzzy match)"),
		name: z.string().describe("Section name (fuzzy match)"),
	},
	async ({ list, name }) => {
		const listName = await resolveListName(list);
		const sectionName = await resolveSectionName(listName, name);
		await deleteSection(listName, sectionName);
		return {
			content: [{ type: "text", text: `Deleted section "${sectionName}" from "${listName}"` }],
		};
	},
);

server.tool(
	"remi_move",
	"Move a reminder to a different section",
	{
		list: z.string().describe("List name (fuzzy match)"),
		title: z.string().describe("Reminder title (fuzzy match)"),
		toSection: z.string().describe("Target section name (fuzzy match)"),
	},
	async ({ list, title, toSection }) => {
		const listName = await resolveListName(list);
		const sectionName = await resolveSectionName(listName, toSection);
		const { warning } = await assignToSection(listName, title, sectionName);
		let msg = `Moved "${title}" to section "${sectionName}"`;
		if (warning) msg += ` (${warning})`;
		return { content: [{ type: "text", text: msg }] };
	},
);

// -- Query operations --

server.tool("remi_today", "Show reminders due today", {}, async () => {
	const reminders = await eventkit.getReminders({ filter: "today" });
	return { content: [{ type: "text", text: JSON.stringify(reminders, null, 2) }] };
});

server.tool("remi_overdue", "Show overdue reminders", {}, async () => {
	const reminders = await eventkit.getReminders({ filter: "overdue" });
	return { content: [{ type: "text", text: JSON.stringify(reminders, null, 2) }] };
});

server.tool(
	"remi_upcoming",
	"Show upcoming reminders",
	{
		days: z.number().optional().describe("Number of days to look ahead (default: 7)"),
	},
	async ({ days }) => {
		const reminders = await eventkit.getReminders({ filter: "upcoming", days: days ?? 7 });
		return { content: [{ type: "text", text: JSON.stringify(reminders, null, 2) }] };
	},
);

server.tool(
	"remi_search",
	"Search reminders across all lists",
	{
		query: z.string().describe("Search query (matches title and notes)"),
	},
	async ({ query }) => {
		const reminders = await eventkit.searchReminders(query);
		return { content: [{ type: "text", text: JSON.stringify(reminders, null, 2) }] };
	},
);

// -- Start server --

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error("MCP server error:", err);
	process.exit(1);
});
