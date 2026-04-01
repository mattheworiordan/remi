import { describe, expect, it } from "vitest";
import { parseDate } from "../../src/core/dateparse.js";

describe("parseDate", () => {
	it("passes through YYYY-MM-DD format", () => {
		expect(parseDate("2026-04-15")).toBe("2026-04-15");
		expect(parseDate("2026-12-31")).toBe("2026-12-31");
	});

	it("parses 'tomorrow'", () => {
		const result = parseDate("tomorrow");
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		// Should be after today
		const parsed = new Date(`${result}T00:00:00`);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		expect(parsed.getTime()).toBeGreaterThan(today.getTime());
	});

	it("parses 'in 3 days'", () => {
		const result = parseDate("in 3 days");
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("parses 'next friday'", () => {
		const result = parseDate("next friday");
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const parsed = new Date(`${result}T00:00:00`);
		expect(parsed.getDay()).toBe(5); // Friday
	});

	it("trims whitespace", () => {
		expect(parseDate("  2026-04-15  ")).toBe("2026-04-15");
	});

	it("throws on unparseable input", () => {
		expect(() => parseDate("not a date")).toThrow();
		expect(() => parseDate("")).toThrow();
	});
});
