/**
 * Integration tests for CRUD operations against real Apple Reminders.
 *
 * These tests create/modify/delete real reminders and lists.
 * They require macOS with Reminders access granted.
 *
 * Run: npm run test:integration
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	cleanupStaleTestLists,
	remi,
	setupTestList,
	teardownTestList,
} from "../helpers/test-list.js";

describe("CRUD integration", () => {
	let listName: string;

	beforeAll(async () => {
		await cleanupStaleTestLists();
		listName = await setupTestList();
	}, 60000);

	afterAll(async () => {
		await teardownTestList(listName);
	}, 30000);

	it("lists shows the test list", async () => {
		const result = await remi("lists");
		expect(result.success).toBe(true);
		const lists = result.data as Array<{ title: string }>;
		expect(lists.some((l) => l.title === listName)).toBe(true);
	}, 45000);

	it("add creates a reminder", async () => {
		const result = await remi("add", listName, "Integration test item");
		expect(result.success).toBe(true);
		expect(result.data).toHaveProperty("id");
	}, 45000);

	it("list shows the created reminder", async () => {
		const result = await remi("list", listName);
		expect(result.success).toBe(true);
		const reminders = result.data as Array<{ title: string }>;
		expect(reminders.some((r) => r.title === "Integration test item")).toBe(true);
	}, 45000);

	it("add with due date and priority", async () => {
		const result = await remi(
			"add",
			listName,
			"Urgent task",
			"--due",
			"2026-12-25",
			"--priority",
			"high",
		);
		expect(result.success).toBe(true);

		const list = await remi("list", listName);
		const reminders = list.data as Array<{ title: string; dueDate?: string; priority: string }>;
		const item = reminders.find((r) => r.title === "Urgent task");
		expect(item).toBeDefined();
		expect(item?.dueDate).toBe("2026-12-25");
		expect(item?.priority).toBe("high");
	}, 45000);

	it("add with natural language date", async () => {
		const result = await remi("add", listName, "NLP date task", "--due", "tomorrow");
		expect(result.success).toBe(true);

		const list = await remi("list", listName);
		const reminders = list.data as Array<{ title: string; dueDate?: string }>;
		const item = reminders.find((r) => r.title === "NLP date task");
		expect(item).toBeDefined();
		expect(item?.dueDate).toBeDefined();
	}, 45000);

	it("add with recurrence", async () => {
		const result = await remi(
			"add",
			listName,
			"Recurring task",
			"--due",
			"2026-12-25",
			"--repeat",
			"weekly",
		);
		expect(result.success).toBe(true);

		const list = await remi("list", listName);
		const reminders = list.data as Array<{
			title: string;
			isRecurring: boolean;
			recurrence?: string;
		}>;
		const item = reminders.find((r) => r.title === "Recurring task");
		expect(item).toBeDefined();
		expect(item?.isRecurring).toBe(true);
		expect(item?.recurrence).toBe("weekly");
	}, 45000);

	it("complete marks a reminder done", async () => {
		const result = await remi("complete", listName, "Integration test item");
		expect(result.success).toBe(true);

		// Should no longer appear in incomplete list
		const list = await remi("list", listName);
		const reminders = list.data as Array<{ title: string }>;
		expect(reminders.some((r) => r.title === "Integration test item")).toBe(false);
	}, 45000);

	it("update changes reminder properties", async () => {
		const result = await remi(
			"update",
			listName,
			"Urgent task",
			"--title",
			"Updated task",
			"--priority",
			"low",
		);
		expect(result.success).toBe(true);

		const list = await remi("list", listName);
		const reminders = list.data as Array<{ title: string; priority: string }>;
		const item = reminders.find((r) => r.title === "Updated task");
		expect(item).toBeDefined();
		expect(item?.priority).toBe("low");
	}, 45000);

	it("search finds reminders across lists", async () => {
		const result = await remi("search", "Updated task");
		expect(result.success).toBe(true);
		const reminders = result.data as Array<{ title: string; listName: string }>;
		expect(reminders.some((r) => r.title === "Updated task" && r.listName === listName)).toBe(true);
	}, 45000);

	it("delete removes a reminder", async () => {
		const result = await remi("delete", listName, "NLP date task", "--confirm");
		expect(result.success).toBe(true);

		const list = await remi("list", listName);
		const reminders = list.data as Array<{ title: string }>;
		expect(reminders.some((r) => r.title === "NLP date task")).toBe(false);
	}, 45000);

	it("create-list is idempotent", async () => {
		const result = await remi("create-list", listName);
		expect(result.success).toBe(true);
	}, 45000);
});
