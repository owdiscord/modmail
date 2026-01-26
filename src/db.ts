import { SQL } from "bun";
import config from "./cfg";

let db: SQL | null = null;

export function useDb(): SQL {
  if (db) return db;

  db = new SQL({
    adapter: "mysql",
    hostname: config.mysqlOptions.host,
    port: config.mysqlOptions.port,
    database: config.mysqlOptions.database,
    username: config.mysqlOptions.user,
    password: config.mysqlOptions.password,
  });

  db`SET time_zone = '+00:00';`.catch((e) =>
    console.error(`could not set timezone: ${e}`),
  );

  return db;
}
