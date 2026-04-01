/**
 * SHA-512 checksum computation for section membership data.
 *
 * Apple's remindd uses checksums to detect data corruption in the membership field.
 * The checksum is computed on the exact JSON string stored in
 * ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA — any difference in whitespace or key order
 * produces a different checksum.
 */

import { createHash } from "node:crypto";

export function computeMembershipChecksum(membershipJson: string): string {
	return createHash("sha512").update(membershipJson, "utf8").digest("hex");
}
