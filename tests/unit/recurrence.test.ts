import { describe, expect, it } from "vitest";
import { parseRepeat } from "../../src/core/recurrence.js";

describe("parseRepeat", () => {
	it("parses simple frequencies", () => {
		expect(parseRepeat("daily")).toEqual({ rruleFreq: "DAILY", rruleInterval: 1 });
		expect(parseRepeat("weekly")).toEqual({ rruleFreq: "WEEKLY", rruleInterval: 1 });
		expect(parseRepeat("monthly")).toEqual({ rruleFreq: "MONTHLY", rruleInterval: 1 });
		expect(parseRepeat("yearly")).toEqual({ rruleFreq: "YEARLY", rruleInterval: 1 });
	});

	it("parses 'every N unit' format", () => {
		expect(parseRepeat("every 2 weeks")).toEqual({ rruleFreq: "WEEKLY", rruleInterval: 2 });
		expect(parseRepeat("every 3 months")).toEqual({ rruleFreq: "MONTHLY", rruleInterval: 3 });
		expect(parseRepeat("every 5 days")).toEqual({ rruleFreq: "DAILY", rruleInterval: 5 });
	});

	it("parses 'every unit' (no number = interval 1)", () => {
		expect(parseRepeat("every week")).toEqual({ rruleFreq: "WEEKLY", rruleInterval: 1 });
		expect(parseRepeat("every month")).toEqual({ rruleFreq: "MONTHLY", rruleInterval: 1 });
	});

	it("parses day-of-week specifiers", () => {
		const result = parseRepeat("every 2 weeks on monday,friday");
		expect(result.rruleFreq).toBe("WEEKLY");
		expect(result.rruleInterval).toBe(2);
		expect(result.rruleDays).toEqual([2, 6]);
	});

	it("handles abbreviated day names", () => {
		const result = parseRepeat("every week on mon,wed,fri");
		expect(result.rruleDays).toEqual([2, 4, 6]);
	});

	it("is case-insensitive", () => {
		expect(parseRepeat("Daily")).toEqual({ rruleFreq: "DAILY", rruleInterval: 1 });
		expect(parseRepeat("EVERY 2 WEEKS")).toEqual({ rruleFreq: "WEEKLY", rruleInterval: 2 });
	});

	it("trims whitespace", () => {
		expect(parseRepeat("  daily  ")).toEqual({ rruleFreq: "DAILY", rruleInterval: 1 });
	});

	it("throws on invalid input", () => {
		expect(() => parseRepeat("never")).toThrow();
		expect(() => parseRepeat("every 2 blobs")).toThrow();
		expect(() => parseRepeat("")).toThrow();
	});

	it("throws on invalid day names", () => {
		expect(() => parseRepeat("every week on funday")).toThrow();
	});
});
