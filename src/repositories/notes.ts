import type { RowDataPacket } from "mysql2";
import type { DbQuery } from "../db";

export interface Note {
  id: number;
  user_id: string;
  author_id: string;
  body: string;
  created_at: Date;
}

export type NoteRow = Note & RowDataPacket;

// Find a note for a specific user by their snowflake ID
export async function findNotesByUserId(sql: DbQuery, userId: string) {
  return (
    (await sql<NoteRow>`SELECT * FROM notes WHERE user_id = ${userId}`) || []
  );
}

// Find a note by it's given ID
export async function findNote(sql: DbQuery, id: string) {
  const notes =
    await sql<NoteRow>`SELECT * FROM notes WHERE id = ${id} LIMIT 1`;

  return notes?.[0] ? notes[0] : null;
}

// Delete a note from the database
export async function deleteNote(sql: DbQuery, id: string) {
  return await sql.mutation`DELETE FROM notes WHERE id = ${id}`;
}

// Create a new user note
export async function createUserNote(
  sql: DbQuery,
  user_id: string,
  author_id: string,
  body: string,
) {
  await sql`INSERT INTO notes (
    user_id,
    author_id,
    body,
    created_at
  ) VALUES (
    ${user_id},
    ${author_id},
    ${body},
    now()
  )}`;
}
