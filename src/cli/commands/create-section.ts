import { ErrorCode, RemiCommandError } from "../../core/errors.js";

export async function createSectionCommand(_list: string, _name: string): Promise<void> {
	throw new RemiCommandError(ErrorCode.UNKNOWN, "Not implemented yet — coming in Phase 3");
}
