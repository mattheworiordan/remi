/**
 * Date parsing — supports both YYYY-MM-DD and natural language ("next tuesday", "in 3 days").
 *
 * Uses chrono-node for natural language, falls back to direct parsing for ISO dates.
 * Returns YYYY-MM-DD format (what the Swift helper expects).
 */

import * as chrono from "chrono-node";
import { ErrorCode, RemiCommandError } from "./errors.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(input: string): string {
	const trimmed = input.trim();

	// Already YYYY-MM-DD — pass through
	if (ISO_DATE_RE.test(trimmed)) {
		return trimmed;
	}

	// Try natural language parsing
	const results = chrono.parse(trimmed, new Date(), { forwardDate: true });
	if (results.length > 0) {
		const date = results[0].start.date();
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, "0");
		const d = String(date.getDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	}

	throw new RemiCommandError(
		ErrorCode.INVALID_ARGUMENT,
		`Cannot parse date "${input}"`,
		'Use YYYY-MM-DD or natural language: "tomorrow", "next tuesday", "in 3 days"',
	);
}
