import { assignToSection } from "../../core/membership.js";
import { resolveListName, resolveSectionName } from "../../core/resolve.js";
import { outputMessage } from "../output.js";

export async function moveCommand(
	list: string,
	title: string,
	opts: { toSection: string },
): Promise<void> {
	const listName = await resolveListName(list);
	const sectionName = await resolveSectionName(listName, opts.toSection);
	const { warning } = await assignToSection(listName, title, sectionName);
	let msg = `Moved "${title}" to section "${sectionName}" in "${listName}"`;
	if (warning) msg += ` (note: ${warning})`;
	outputMessage(msg);
}
