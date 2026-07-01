import type { RowDataPacket } from "mysql2";
import type { DbQuery } from "../db";

export interface Snippet {
  trigger: string;
  body: string;
  created_by: string;
  created_at: Date;
}

export type SnippetRow = Snippet & RowDataPacket;

// Get a single snippet by its trigger string
export async function getSnippet(
  sql: DbQuery,
  trigger: string,
): Promise<Snippet | null> {
  const snippet =
    await sql<SnippetRow>`SELECT * FROM snippets WHERE LOWER(\`trigger\`) = ${trigger.toLowerCase()} LIMIT 1`;

  return snippet?.[0] ? snippet[0] : null;
}

// Insert a new snippet to the database. Fail if it already exists.
export async function addSnippet(
  sql: DbQuery,
  trigger: string,
  body: string,
  created_by = "",
) {
  if (await getSnippet(sql, trigger)) return;

  return await sql.mutation`INSERT INTO snippets (trigger, body, created_by, created_at) VALUES (${trigger}, ${body}, ${created_by}, now())`;
}

// Delete a given snippet by it's trigger
export async function deleteSnippet(sql: DbQuery, trigger: string) {
  return await sql.mutation`DELETE FROM snippets WHERE LOWER(\`trigger\`) = ${trigger.toLowerCase()} LIMIT 1`;
}

// Return all snippets
export async function allSnippets(sql: DbQuery) {
  const snippets =
    await sql<SnippetRow>`SELECT trigger, body, created_at, created_by FROM snippets`;

  return snippets || [];
}
