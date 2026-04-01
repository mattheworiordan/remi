import { ErrorCode, RemiCommandError } from "../../core/errors.js";

export async function sectionsCommand(_list: string): Promise<void> {
	throw new RemiCommandError(ErrorCode.UNKNOWN, "Not implemented yet — coming in Phase 3");
}
