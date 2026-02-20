import { SQL } from "bun";
import config from "./config";

let db: SQL | null = null;

export function useDb(): SQL {
  if (db) return db;

  db = new SQL({
    adapter: "mariadb",
    hostname: config.secrets.database.host,
    port: config.secrets.database.port,
    database: config.secrets.database.database,
    username: config.secrets.database.user,
    password: config.secrets.database.password,
    prepare: false,
  });

  db`SET time_zone = '+00:00';`.catch((e) =>
    console.error(`could not set timezone: ${e}`),
  );

  return db;
}
