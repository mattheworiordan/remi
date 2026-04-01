import { createList } from "../../core/eventkit.js";
import { outputMessage } from "../output.js";

export async function createListCommand(name: string): Promise<void> {
	const id = await createList(name);
	outputMessage(`Created list "${name}"`, { id });
}
