import { readdir } from "node:fs/promises";
import { parse as parsePath } from "node:path";
import { useDb } from "./db";
import { noop } from "./utils";

const db = useDb();

// TODO: Migration engine to replace Knex fully
export async function doMigration() {
  console.log("[migrate] Creating database connection");
  const migrationTableName = "schema_migrations";
  console.log("[migrate] Updating migration table name if applicable");

  // First, just make sure we are migrating any old knex stuff
  await db`RENAME TABLE knex_migrations TO ${migrationTableName};`.catch((_) =>
    noop(),
  );

  try {
    await db`UPDATE ${db(migrationTableName)}
SET name = SUBSTRING(name, 1, LENGTH(name) - 3)
WHERE name LIKE '%.js';`;
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  await db`CREATE TABLE IF NOT EXISTS schema_migrations (
    id integer PRIMARY KEY,
    name varchar(256) NOT NULL,
    batch integer NOT NULL DEFAULT 1,
    migration_time datetime DEFAULT now()
  )`;

  console.log("[migrate] Reading migration directory");

  const files = (await readdir("./migrations")).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );

  for (const file of files) {
    const { name, ext } = parsePath(file);
    if (ext !== ".sql") continue;

    const res =
      await db`SELECT COUNT(*) FROM ${db(migrationTableName)} WHERE name = ${name + ".js"}`;

    if (res.count > 0) continue;

    console.log(`migration time for ${name}`);
  }
}

if (import.meta.main) doMigration();

function timestamp(): string {
  const now = new Date();

  return (
    now.getUTCFullYear().toString() +
    (now.getUTCMonth() + 1).toString().padStart(2, "0") +
    now.getUTCDate().toString().padStart(2, "0") +
    now.getUTCHours().toString().padStart(2, "0") +
    now.getUTCMinutes().toString().padStart(2, "0") +
    now.getUTCSeconds().toString().padStart(2, "0")
  );
}
