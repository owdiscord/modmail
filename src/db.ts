import { SQL } from "bun";
import config from "./cfg";

const db: SQL | null = null;

export function useDb(): SQL {
	if (db) return db;

	return new SQL(
		`mysql://${config.mysqlOptions.user}:${config.mysqlOptions.password}@${config.mysqlOptions.host}:${config.mysqlOptions.port}/${config.mysqlOptions.database}?timezone=Z`,
	);
}
