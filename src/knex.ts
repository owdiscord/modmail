import path from "node:path";
import { knex } from "knex";
import cfg from "./cfg";

const { mysqlOptions } = cfg;

// if (dbType === "sqlite" && sqliteOptions) {
//   const resolvedPath = path.resolve(process.cwd(), sqliteOptions.filename);
//   console.log(`Using an SQLite database:\n  ${resolvedPath}`);
//
//   const db = new Database(sqliteOptions.filename);
//
//   baseOptions = {
//     client: "bun-sqlite3",
//     useNullAsDefault: true,
//     pool: {
//       afterCreate: (conn: any, done: any) => {
//         conn.db = db;
//         done(null, conn);
//       },
//     },
//     connection: {
//       ...sqliteOptions,
//     },
//   };
// }
//

if (mysqlOptions) {
	const host = mysqlOptions.host || "localhost";
	const port = mysqlOptions.port || 3306;
	const mysqlStr = `${mysqlOptions.user}@${host}:${port}/${mysqlOptions.database}`;
	console.log(`Using a MySQL database:\n  ${mysqlStr}`);
}

const config = {
	client: "mysql2",
	connection: {
		host: mysqlOptions.host,
		port: mysqlOptions.port,
		user: mysqlOptions.user,
		password: mysqlOptions.password,
		database: mysqlOptions.database,
	},
	useNullAsDefault: true,
	migrations: {
		directory: path.resolve(__dirname, "data", "migrations"),
	},
	log: {
		error(err: Error) {
			console.error(err);
		},
		warn(message: string) {
			if (
				message.startsWith(
					"FS-related option specified for migration configuration",
				)
			) {
				return;
			}

			if (message === "Connection Error: Error: read ECONNRESET") {
				// Knex automatically handles the reconnection
				return;
			}

			console.warn(`[DATABASE WARNING] ${message}`);
		},
	},
};

const db = knex(config);

export default db;
