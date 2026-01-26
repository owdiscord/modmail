import { useDb } from "../db";
import { Note } from "./Note";

const db = useDb();

export async function findNotesByUserId(userId: string) {
	const rows = await db`SELECT * FROM notes WHERE user_id = ${userId}`;

	return rows.map(
		(row: {
			id?: number;
			user_id: string;
			author_id: string;
			body: string;
			created_at?: Date;
		}) => new Note(row),
	);
}

export async function findNote(id: string) {
	const rows = await db`SELECT * FROM notes WHERE id = ${id} LIMIT 1`;
	if (!rows || rows.length !== 1) throw new Error("too many notes");

	return new Note(rows[0]);
}

export async function deleteNote(id: string) {
	return await db`DELETE FROM notes WHERE id = ${id}`;
}

export async function createUserNote(
	user_id: string,
	author_id: string,
	body: string,
) {
	const created = await db`INSERT INTO notes ${db({
		user_id,
		author_id,
		body,
		created_at: new Date(),
	})}`;

	return new Note(created);
}
