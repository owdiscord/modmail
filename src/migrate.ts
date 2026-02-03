import { readdir } from "node:fs/promises";
import { useDb } from "./db";
import { noop } from "./utils";

const db = useDb();
const migrationTableName = "schema_migrations";

async function createMigrationTable() {
  // First, just make sure we are migrating any old knex stuff
  await db`RENAME TABLE knex_migrations TO ${db(migrationTableName)};`.catch(
    (_) => noop(),
  );

  try {
    await db`UPDATE ${db(migrationTableName)}
SET name = SUBSTRING(name, 1, LENGTH(name) - 3)
WHERE name LIKE '%.js';`;
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  await db`CREATE TABLE IF NOT EXISTS ${db(migrationTableName)} (
    id integer PRIMARY KEY,
    name varchar(256) NOT NULL,
    batch integer NOT NULL DEFAULT 1,
    migration_time datetime DEFAULT now()
  )`;
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const rows = await db<
    { name: string }[]
  >`SELECT name FROM ${db(migrationTableName)}`;

  return new Set(rows.map((row) => row.name));
}

async function getMigrationsFromFilesystem(): Promise<
  { name: string; up: string; down: string }[]
> {
  const files = (await readdir("./migrations")).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );

  const migrations = await Promise.all(
    files.map(async (name) => {
      if (!name.endsWith(".sql")) return null;

      const contents = await Bun.file(`./migrations/${name}`).text();
      const upMatch = contents.match(
        /-- migrate:up\s+([\s\S]*?)(?=-- migrate:down|$)/,
      );
      const downMatch = contents.match(/-- migrate:down\s+([\s\S]*?)$/);

      const up = upMatch?.[1] ? upMatch[1].trim() : contents.trim();
      const down = downMatch?.[1] ? downMatch[1].trim() : "";

      return { name: name.substring(0, name.length - 4), up, down };
    }),
  );

  return migrations.filter(
    (el): el is { name: string; up: string; down: string } => el !== null,
  );
}

export async function migrateDown(migration: string) {
  const applied = await getAppliedMigrations();
  if (!applied.has(migration)) {
    console.error(
      "[migrate] the migration you attempted to down does not exist or has not been run",
    );
    process.exit(1);
  }

  const migrations = await getMigrationsFromFilesystem();
  const found = migrations.find((mig) => mig.name === migration);
  if (!found) {
    console.error(
      "[migrate] the migration you attempted to down does not exist in the filesystem",
    );
    process.exit(1);
  }

  const { down, name } = found;

  await db.begin(async (sql) => {
    try {
      await sql.unsafe(down);
      await sql`DELETE FROM ${sql(migrationTableName)} WHERE name = ${name}`;
    } catch (e) {
      console.error(`[migrate] Failed to down ${name}:\n${e}`);
      process.exit(1);
    }
  });

  console.log(`[migrate] Downed ${name}`);
}

export async function migrateAllUp() {
  // Create (or rename, if applicable) the migration table
  createMigrationTable();

  const applied = await getAppliedMigrations();

  console.log("[migrate] Reading migration directory");
  const migrations = await getMigrationsFromFilesystem();

  let count = 0;
  for (const { name, up } of migrations) {
    if (!applied.has(name))
      await db.begin(async (sql) => {
        try {
          await sql.unsafe(up);
          await sql`INSERT INTO ${sql(migrationTableName)} (name, batch, migration_time) VALUES (${name}, 1, now())`;
        } catch (e) {
          console.error(`[migrate] Failed to run ${name}:\n${e}`);
          process.exit(1);
        } finally {
          console.log(`[migrate] Ran ${name}`);
          count++;
        }
      });
  }

  if (count > 0)
    console.log(`[migrate] Successfully ran ${count} migration(s).`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "up") await migrateAllUp();

  if (args[0] === "new") {
    const name = args.slice(1);
    if (name.length < 1) {
      console.error("[migrate] you must provide a name to create a migration");
      process.exit(1);
    }

    const fileName = `${timestamp()}_${name
      .map((arg) => arg.toLowerCase().trim().replace(/[.\s]/g, "_"))
      .join("_")}.sql`;
    console.log(`[migrate] created migration ${fileName}`);
    await Bun.write(
      `./migrations/${fileName}`,
      "-- migrate:up\n\n\n-- migrate:down\n\n",
    );
  }

  if (args[0] === "down") {
    if (args.length < 2) {
      console.error(
        "[migrate] you cannot down every migration. please specify at least one",
      );
      process.exit(1);
    }

    await migrateDown(args[1] || "");
  }
}

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
