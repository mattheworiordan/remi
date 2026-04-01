import { assignToSection } from "../../core/membership.js";
import { outputMessage } from "../output.js";

export async function moveCommand(
	list: string,
	title: string,
	opts: { toSection: string },
): Promise<void> {
	const { warning } = await assignToSection(list, title, opts.toSection);
	let msg = `Moved "${title}" to section "${opts.toSection}" in "${list}"`;
	if (warning) {
		msg += ` (note: ${warning})`;
	}
	outputMessage(msg);
}
