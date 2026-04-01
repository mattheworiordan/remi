/** A reminder list (calendar) in Apple Reminders */
export interface ReminderList {
	id: string;
	title: string;
	reminderCount: number;
	overdueCount: number;
}

/** Priority levels matching Apple Reminders */
export type Priority = "none" | "low" | "medium" | "high";

/** A single reminder item */
export interface Reminder {
	id: string;
	title: string;
	isCompleted: boolean;
	listID: string;
	listName: string;
	priority: Priority;
	dueDate?: string;
	completionDate?: string;
	notes?: string;
	section?: string;
	isRecurring?: boolean;
	recurrence?: string;
	flagged?: boolean;
}

/** A section within a reminder list */
export interface Section {
	id: string;
	displayName: string;
	listName: string;
	sortOrder: number;
}

/** Structured result wrapper for all remi operations */
export interface RemiResult<T> {
	success: boolean;
	data?: T;
	error?: RemiError;
}

/** Structured error with machine-readable code and human-readable suggestion */
export interface RemiError {
	code: string;
	message: string;
	suggestion?: string;
}

/** Options for adding a reminder */
export interface AddReminderOptions {
	list: string;
	title: string;
	section?: string;
	due?: string;
	priority?: Priority;
	notes?: string;
}

/** Options for updating a reminder */
export interface UpdateReminderOptions {
	list: string;
	title: string;
	newTitle?: string;
	due?: string;
	clearDue?: boolean;
	priority?: Priority;
	notes?: string;
}

/** Section membership entry in the SQLite database */
export interface MembershipEntry {
	reminderID: string;
	sectionID: string;
}

/** Membership data structure stored in ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA */
export interface MembershipData {
	memberships: MembershipEntry[];
}

/** Token map entry for a single syncable field */
export interface TokenMapEntry {
	counter: number;
	modificationTime: number;
}

/** Resolution token map (CRDT vector clocks for sync) */
export interface TokenMap {
	[fieldName: string]: TokenMapEntry;
}
