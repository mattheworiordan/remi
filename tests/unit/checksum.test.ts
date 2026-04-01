import { describe, expect, it } from "vitest";
import { computeMembershipChecksum } from "../../src/core/checksum.js";

describe("checksum", () => {
	it("produces a 128-character hex string (SHA-512)", () => {
		const result = computeMembershipChecksum("test");
		expect(result).toHaveLength(128);
		expect(result).toMatch(/^[0-9a-f]+$/);
	});

	it("produces consistent output for the same input", () => {
		const input = '{"memberships":[{"memberID":"ABC","groupID":"DEF","modifiedOn":123}]}';
		const a = computeMembershipChecksum(input);
		const b = computeMembershipChecksum(input);
		expect(a).toBe(b);
	});

	it("produces different output for different input", () => {
		const a = computeMembershipChecksum("input1");
		const b = computeMembershipChecksum("input2");
		expect(a).not.toBe(b);
	});

	it("matches known SHA-512 value", () => {
		// SHA-512 of empty string
		const result = computeMembershipChecksum("");
		expect(result).toBe(
			"cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
		);
	});
});
