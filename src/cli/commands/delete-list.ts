import { ErrorCode, RemiCommandError } from "../../core/errors.js";
import { deleteList } from "../../core/eventkit.js";
import { isJsonMode, outputMessage } from "../output.js";

export async function deleteListCommand(name: string, opts: { confirm?: boolean }): Promise<void> {
	if (!opts.confirm && !isJsonMode()) {
		throw new RemiCommandError(
			ErrorCode.INVALID_ARGUMENT,
			"List deletion requires --confirm flag",
			`Run: remi delete-list "${name}" --confirm`,
		);
	}

	await deleteList(name);
	outputMessage(`Deleted list "${name}"`);
}
