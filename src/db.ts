import {
  createPool,
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import config from "./config";

// Database types
type Primitive = string | number | boolean | Date | null;

export type MutationResult = ResultSetHeader;

export interface DbQuery {
  <T extends RowDataPacket>(
    strings: TemplateStringsArray,
    ...values: Primitive[]
  ): Promise<T[]>;
  mutation(
    strings: TemplateStringsArray,
    ...values: Primitive[]
  ): Promise<MutationResult>;
  transaction<T>(fn: (tx: TxQuery) => Promise<T>): Promise<T>;
  raw<T extends RowDataPacket>(sql: string, values: Primitive[]): Promise<T[]>;
  pool: Pool;
}

interface TxQuery {
  <T extends RowDataPacket>(
    strings: TemplateStringsArray,
    ...values: Primitive[]
  ): Promise<T[]>;
  mutation(
    strings: TemplateStringsArray,
    ...values: Primitive[]
  ): Promise<MutationResult>;
  raw<T extends RowDataPacket>(sql: string, values: Primitive[]): Promise<T[]>;
}

// Turn a string template into a mysql2 compatible combination of sql string and param array.
function buildQueryString(
  strings: TemplateStringsArray,
  values: Primitive[],
): string {
  return strings.reduce(
    (acc, str, i) => acc + str + (i < values.length ? "?" : ""),
    "",
  );
}

// Create a transaction query
function createTxQuery(conn: PoolConnection): TxQuery {
  const tx = async <T extends RowDataPacket>(
    strings: TemplateStringsArray,
    ...values: Primitive[]
  ): Promise<T[]> => {
    const [rows] = await conn.execute<T[]>(
      buildQueryString(strings, values),
      values,
    );
    return rows;
  };

  tx.mutation = async (
    strings: TemplateStringsArray,
    ...values: Primitive[]
  ): Promise<MutationResult> => {
    const [result] = await conn.execute<ResultSetHeader>(
      buildQueryString(strings, values),
      values,
    );

    return result;
  };

  tx.raw = <T extends RowDataPacket>(sql: string, values: Primitive[]) =>
    conn.query<T[]>(sql, values).then(([rows]) => rows);

  return tx;
}

// Create the actual database factory now
function createDb(pool: Pool): DbQuery {
  const query = async <T extends RowDataPacket>(
    strings: TemplateStringsArray,
    ...values: Primitive[]
  ): Promise<T[]> => {
    const [rows] = await pool.execute<T[]>(
      buildQueryString(strings, values),
      values,
    );
    return rows;
  };

  query.mutation = async (
    strings: TemplateStringsArray,
    ...values: Primitive[]
  ): Promise<MutationResult> => {
    const [result] = await pool.execute<ResultSetHeader>(
      buildQueryString(strings, values),
      values,
    );
    return result;
  };

  query.transaction = async <T>(
    fn: (tx: TxQuery) => Promise<T>,
  ): Promise<T> => {
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      const result = await fn(createTxQuery(conn));
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  };

  query.raw = <T extends RowDataPacket>(sql: string, values: Primitive[]) =>
    pool.query<T[]>(sql, values).then(([rows]) => rows);

  query.pool = pool;

  return query;
}

// Make sure we use this as a singleton and don't redefine it a trillion times (while also not having to refactor the whole codebase)
let db: DbQuery | null = null;

export function useDb(): DbQuery {
  if (db) return db;

  const pool = createPool({
    host: config.secrets.database.host,
    port: config.secrets.database.port,
    database: config.secrets.database.database,
    user: config.secrets.database.user,
    password: config.secrets.database.password,
    timezone: "+00:00",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true,
    typeCast(field, next) {
      if (
        field.table === "thread_messages" &&
        (field.name === "attachments" || field.name === "small_attachments")
      )
        return JSON.parse(field.string() || "[]") || null;
      if (
        (field.table === "threads" || field.table === "thread_messages") &&
        field.name === "metadata"
      )
        return JSON.parse(field.string() || "{}") || {};

      return next();
    },
  });

  db = createDb(pool);
  return db;
}
