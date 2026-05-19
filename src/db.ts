import config from "./config";
import { type Pool, type PoolOptions, createPool } from "mysql2/promise";

let db: Pool | null = null;

export function useDb(): Pool {
  if (db) return db;

  const options: PoolOptions = {
    host: config.secrets.database.host,
    port: config.secrets.database.port,
    database: config.secrets.database.database,
    user: config.secrets.database.user,
    password: config.secrets.database.password,
    timezone: "+00:00",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  };

  db = createPool(options);

  return db;
}
