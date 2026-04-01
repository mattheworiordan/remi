import { beforeEach, describe, expect, it, vi } from "vitest";
import { outputError, outputMessage, outputSuccess, setJsonMode } from "../../src/cli/output.js";

describe("output", () => {
	let stdoutData: string;
	let stderrData: string;

	beforeEach(() => {
		stdoutData = "";
		stderrData = "";
		vi.spyOn(process.stdout, "write").mockImplementation((data: string | Uint8Array) => {
			stdoutData += String(data);
			return true;
		});
		vi.spyOn(process.stderr, "write").mockImplementation((data: string | Uint8Array) => {
			stderrData += String(data);
			return true;
		});
	});

	describe("JSON mode", () => {
		beforeEach(() => setJsonMode(true));

		it("wraps data in success result", () => {
			outputSuccess({ items: [1, 2, 3] });
			const parsed = JSON.parse(stdoutData);
			expect(parsed.success).toBe(true);
			expect(parsed.data.items).toEqual([1, 2, 3]);
		});

		it("wraps error in failure result", () => {
			outputError({ code: "TEST_ERROR", message: "Something broke", suggestion: "Fix it" });
			const parsed = JSON.parse(stderrData);
			expect(parsed.success).toBe(false);
			expect(parsed.error.code).toBe("TEST_ERROR");
			expect(parsed.error.suggestion).toBe("Fix it");
		});

		it("outputs message as JSON success", () => {
			outputMessage("Created reminder", { id: "abc123" });
			const parsed = JSON.parse(stdoutData);
			expect(parsed.success).toBe(true);
			expect(parsed.data.message).toBe("Created reminder");
			expect(parsed.data.id).toBe("abc123");
		});
	});

	describe("human mode", () => {
		beforeEach(() => setJsonMode(false));

		it("outputs error to stderr with message", () => {
			outputError({ code: "TEST", message: "Oops" });
			expect(stderrData).toContain("Oops");
		});

		it("outputs error with suggestion", () => {
			outputError({ code: "TEST", message: "Oops", suggestion: "Try again" });
			expect(stderrData).toContain("Try again");
		});

		it("outputs success message with checkmark", () => {
			outputMessage("Done!");
			expect(stdoutData).toContain("Done!");
		});
	});
});
