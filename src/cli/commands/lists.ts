import { listLists } from "../../core/eventkit.js";
import { outputLists } from "../output.js";

export async function listsCommand(): Promise<void> {
	const lists = await listLists();
	outputLists(lists);
}
