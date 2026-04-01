/**
 * Integration tests for section operations against real Apple Reminders.
 *
 * Tests section CRUD via ReminderKit and membership sync via SQLite + token maps.
 * Requires macOS with Reminders access and compiled section-helper binary.
 *
 * Run: npm run test:integration
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { remi, setupTestList, teardownTestList } from "../helpers/test-list.js";

describe("sections integration", () => {
	let listName: string;

	beforeAll(async () => {
		listName = await setupTestList();
		// Add some reminders to work with
		await remi("add", listName, "Apple");
		await remi("add", listName, "Banana");
		await remi("add", listName, "Milk");
	}, 90000);

	afterAll(async () => {
		await teardownTestList(listName);
	}, 30000);

	it("create-section creates a section", async () => {
		const result = await remi("create-section", listName, "Produce");
		expect(result.success).toBe(true);
	}, 45000);

	it("create-section is idempotent", async () => {
		const result = await remi("create-section", listName, "Produce");
		expect(result.success).toBe(true);
	}, 45000);

	it("sections lists created sections", async () => {
		await remi("create-section", listName, "Dairy");
		const result = await remi("sections", listName);
		expect(result.success).toBe(true);
		const sections = result.data as Array<{ displayName: string }>;
		expect(sections.some((s) => s.displayName === "Produce")).toBe(true);
		expect(sections.some((s) => s.displayName === "Dairy")).toBe(true);
	}, 45000);

	it("add with --section assigns reminder to section", async () => {
		const result = await remi("add", listName, "Yogurt", "--section", "Dairy");
		expect(result.success).toBe(true);
	}, 45000);

	it("move assigns existing reminder to section", async () => {
		const result = await remi("move", listName, "Apple", "--to-section", "Produce");
		expect(result.success).toBe(true);
	}, 45000);

	it("move to different section (reassignment)", async () => {
		const result = await remi("move", listName, "Apple", "--to-section", "Dairy");
		expect(result.success).toBe(true);
	}, 45000);

	it("delete-section removes a section", async () => {
		await remi("create-section", listName, "Temporary");
		const result = await remi("delete-section", listName, "Temporary");
		expect(result.success).toBe(true);

		const sections = await remi("sections", listName);
		const list = sections.data as Array<{ displayName: string }>;
		expect(list.some((s) => s.displayName === "Temporary")).toBe(false);
	}, 60000);
});
