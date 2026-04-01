import type { RemiError } from "../types.js";

/** Error codes for machine-readable error handling */
export const ErrorCode = {
	PERMISSION_DENIED: "PERMISSION_DENIED",
	LIST_NOT_FOUND: "LIST_NOT_FOUND",
	REMINDER_NOT_FOUND: "REMINDER_NOT_FOUND",
	SECTION_NOT_FOUND: "SECTION_NOT_FOUND",
	AMBIGUOUS_REMINDER: "AMBIGUOUS_REMINDER",
	REMINDERKIT_UNAVAILABLE: "REMINDERKIT_UNAVAILABLE",
	DB_NOT_FOUND: "DB_NOT_FOUND",
	SWIFT_NOT_FOUND: "SWIFT_NOT_FOUND",
	SWIFT_EXECUTION_FAILED: "SWIFT_EXECUTION_FAILED",
	SYNC_TRIGGER_FAILED: "SYNC_TRIGGER_FAILED",
	INVALID_ARGUMENT: "INVALID_ARGUMENT",
	UNKNOWN: "UNKNOWN",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Create a structured RemiError */
export function createError(code: ErrorCode, message: string, suggestion?: string): RemiError {
	return { code, message, suggestion };
}

/** RemiError as a throwable Error subclass */
export class RemiCommandError extends Error {
	readonly code: ErrorCode;
	readonly suggestion?: string;

	constructor(code: ErrorCode, message: string, suggestion?: string) {
		super(message);
		this.name = "RemiCommandError";
		this.code = code;
		this.suggestion = suggestion;
	}

	toRemiError(): RemiError {
		return { code: this.code, message: this.message, suggestion: this.suggestion };
	}
}
