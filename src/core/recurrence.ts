/**
 * Parse human-friendly --repeat strings into EKRecurrenceRule parameters.
 *
 * Supported formats:
 *   "daily", "weekly", "monthly", "yearly"
 *   "every 2 weeks", "every 3 months"
 *   "every 2 weeks on monday,friday"
 */

import { ErrorCode, RemiCommandError } from "./errors.js";

export interface RecurrenceParams {
	rruleFreq: string;
	rruleInterval: number;
	rruleDays?: number[];
}

const DAY_MAP: Record<string, number> = {
	sunday: 1,
	sun: 1,
	monday: 2,
	mon: 2,
	tuesday: 3,
	tue: 3,
	wednesday: 4,
	wed: 4,
	thursday: 5,
	thu: 5,
	friday: 6,
	fri: 6,
	saturday: 7,
	sat: 7,
};

const FREQ_ALIASES: Record<string, string> = {
	daily: "DAILY",
	weekly: "WEEKLY",
	monthly: "MONTHLY",
	yearly: "YEARLY",
	day: "DAILY",
	days: "DAILY",
	week: "WEEKLY",
	weeks: "WEEKLY",
	month: "MONTHLY",
	months: "MONTHLY",
	year: "YEARLY",
	years: "YEARLY",
};

export function parseRepeat(input: string): RecurrenceParams {
	const s = input.trim().toLowerCase();

	// Simple: "daily", "weekly", "monthly", "yearly"
	if (FREQ_ALIASES[s]) {
		return { rruleFreq: FREQ_ALIASES[s], rruleInterval: 1 };
	}

	// "every N <unit>" with optional "on <days>"
	const match = s.match(/^every\s+(\d+)\s+(\w+?)(?:\s+on\s+(.+))?$/);
	if (match) {
		const interval = Number.parseInt(match[1], 10);
		const unit = match[2];
		const freq = FREQ_ALIASES[unit];
		if (!freq) {
			throw new RemiCommandError(
				ErrorCode.INVALID_ARGUMENT,
				`Unknown frequency unit "${unit}"`,
				"Use: day(s), week(s), month(s), year(s)",
			);
		}

		const result: RecurrenceParams = { rruleFreq: freq, rruleInterval: interval };

		if (match[3]) {
			result.rruleDays = parseDays(match[3]);
		}

		return result;
	}

	// "every <unit>" (no number = interval 1)
	const simpleEvery = s.match(/^every\s+(\w+?)(?:\s+on\s+(.+))?$/);
	if (simpleEvery) {
		const unit = simpleEvery[1];
		const freq = FREQ_ALIASES[unit];
		if (freq) {
			const result: RecurrenceParams = { rruleFreq: freq, rruleInterval: 1 };
			if (simpleEvery[2]) {
				result.rruleDays = parseDays(simpleEvery[2]);
			}
			return result;
		}
	}

	throw new RemiCommandError(
		ErrorCode.INVALID_ARGUMENT,
		`Cannot parse repeat rule "${input}"`,
		'Examples: "daily", "weekly", "every 2 weeks", "every 3 months"',
	);
}

function parseDays(input: string): number[] {
	const days = input.split(/[,\s]+/).map((d) => d.trim().toLowerCase());
	const result: number[] = [];
	for (const day of days) {
		if (!day) continue;
		const num = DAY_MAP[day];
		if (!num) {
			throw new RemiCommandError(
				ErrorCode.INVALID_ARGUMENT,
				`Unknown day "${day}"`,
				"Use: monday, tuesday, wednesday, thursday, friday, saturday, sunday (or mon, tue, etc.)",
			);
		}
		result.push(num);
	}
	return result;
}
