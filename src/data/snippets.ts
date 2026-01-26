import { useDb } from "../db";
import { Snippet } from "./Snippet";

const db = useDb();

export async function get(trigger: string): Promise<Snippet | null> {
	const snippet =
		await db`SELECT * FROM snippets WHERE LOWER(\`trigger\`) = ${trigger.toLowerCase()} LIMIT 1`;

	if (snippet && snippet.length === 1) return new Snippet(snippet[0]);

	return null;
}

export async function add(trigger: string, body: string, created_by = "") {
	if (await get(trigger)) return;

	return await db`INSERT INTO snippets ${db({ trigger, body, created_by, created_at: new Date() })}`;
}

export async function del(trigger: string) {
	return await db`DELETE FROM snippets WHERE LOWER(\`trigger\`) = ${trigger.toLowerCase()} LIMIT 1`;
}

export async function all() {
	const snippets = await db`SELECT * FROM snippets`;

	return snippets.map(
		(s: {
			trigger: string;
			body: string;
			created_at: Date;
			created_by: string;
		}) => new Snippet(s),
	);
}
