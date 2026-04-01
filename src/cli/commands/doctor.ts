import { ErrorCode, RemiCommandError } from "../../core/errors.js";

export async function doctorCommand(_opts: { sync?: boolean; db?: boolean }): Promise<void> {
	throw new RemiCommandError(ErrorCode.UNKNOWN, "Not implemented yet — coming in Phase 4");
}
