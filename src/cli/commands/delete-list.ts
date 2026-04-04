import { ErrorCode, RemiCommandError } from "../../core/errors.js";
import { deleteList } from "../../core/eventkit.js";
import { resolveListName } from "../../core/resolve.js";
import { isJsonMode, outputMessage } from "../output.js";

export async function deleteListCommand(name: string, opts: { confirm?: boolean }): Promise<void> {
	if (!opts.confirm && !isJsonMode()) {
		throw new RemiCommandError(
			ErrorCode.INVALID_ARGUMENT,
			"List deletion requires --confirm flag",
			`Run: remi delete-list "${name}" --confirm`,
		);
	}

	const listName = await resolveListName(name);
	await deleteList(listName);
	outputMessage(`Deleted list "${listName}"`);
}
