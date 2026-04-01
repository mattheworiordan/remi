import { describe, expect, it } from "vitest";
import {
	getMembershipCounter,
	incrementMembershipCounter,
	parseTokenMap,
	serializeTokenMap,
} from "../../src/core/tokenmap.js";

describe("tokenmap", () => {
	describe("parseTokenMap", () => {
		it("returns empty map for null input", () => {
			expect(parseTokenMap(null)).toEqual({});
		});

		it("returns empty map for empty string", () => {
			expect(parseTokenMap("")).toEqual({});
		});

		it("returns empty map for invalid JSON", () => {
			expect(parseTokenMap("not json")).toEqual({});
		});

		it("parses valid token map JSON", () => {
			const json = JSON.stringify({
				displayName: { counter: 2, modificationTime: 733456700 },
				membershipsOfRemindersInSectionsChecksum: { counter: 5, modificationTime: 733456789 },
			});
			const result = parseTokenMap(json);
			expect(result.displayName).toEqual({ counter: 2, modificationTime: 733456700 });
			expect(result.membershipsOfRemindersInSectionsChecksum).toEqual({
				counter: 5,
				modificationTime: 733456789,
			});
		});
	});

	describe("incrementMembershipCounter", () => {
		it("creates entry if not present", () => {
			const result = incrementMembershipCounter({}, 1000);
			expect(result.membershipsOfRemindersInSectionsChecksum).toEqual({
				counter: 1,
				modificationTime: 1000,
			});
		});

		it("increments existing counter", () => {
			const tokenMap = {
				membershipsOfRemindersInSectionsChecksum: { counter: 5, modificationTime: 500 },
			};
			const result = incrementMembershipCounter(tokenMap, 1000);
			expect(result.membershipsOfRemindersInSectionsChecksum).toEqual({
				counter: 6,
				modificationTime: 1000,
			});
		});

		it("preserves other fields", () => {
			const tokenMap = {
				displayName: { counter: 2, modificationTime: 700 },
				membershipsOfRemindersInSectionsChecksum: { counter: 3, modificationTime: 800 },
			};
			const result = incrementMembershipCounter(tokenMap, 1000);
			expect(result.displayName).toEqual({ counter: 2, modificationTime: 700 });
			expect(result.membershipsOfRemindersInSectionsChecksum.counter).toBe(4);
		});

		it("does not mutate the input", () => {
			const tokenMap = {
				membershipsOfRemindersInSectionsChecksum: { counter: 1, modificationTime: 500 },
			};
			const original = JSON.parse(JSON.stringify(tokenMap));
			incrementMembershipCounter(tokenMap, 1000);
			expect(tokenMap).toEqual(original);
		});
	});

	describe("getMembershipCounter", () => {
		it("returns 0 for empty map", () => {
			expect(getMembershipCounter({})).toBe(0);
		});

		it("returns current counter value", () => {
			expect(
				getMembershipCounter({
					membershipsOfRemindersInSectionsChecksum: { counter: 7, modificationTime: 0 },
				}),
			).toBe(7);
		});
	});

	describe("serializeTokenMap", () => {
		it("produces valid JSON", () => {
			const tokenMap = {
				b: { counter: 1, modificationTime: 0 },
				a: { counter: 2, modificationTime: 0 },
			};
			const json = serializeTokenMap(tokenMap);
			expect(JSON.parse(json)).toBeTruthy();
		});
	});
});
