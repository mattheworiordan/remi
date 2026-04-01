import { ErrorCode, RemiCommandError } from "../../core/errors.js";

export async function moveCommand(
	_list: string,
	_title: string,
	_opts: { toSection: string },
): Promise<void> {
	throw new RemiCommandError(ErrorCode.UNKNOWN, "Not implemented yet — coming in Phase 3");
}
