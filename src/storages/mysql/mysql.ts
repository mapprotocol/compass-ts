import mysql from "mysql2";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { Log } from '../model'

export let db: mysql.Connection;
export let pool: mysql.Pool;

export function initDb(user: string, psw: string, database: string, host: string, port: number) {
  pool = mysql.createPool({
    user: user,
    password: psw,
    database: database,
    host: host,
    port: port,
  })
}

type InsertCallback = (error: Error | null, id?: number) => void;
let syncCursorTableReady = false;
let syncDeadLetterTableReady = false;

export const insertMos = (log: Log, callback?: InsertCallback): Promise<number> => {
  return new Promise((resolve, reject) => {
    pool.getConnection((error, connection) => {
      if (error) {
        callback?.(error);
        reject(error);
        return;
      }

      const insertStr = "INSERT INTO mos (chain_id, event_id, project_id, tx_hash, contract_address, topic, block_number, block_hash, tx_index, log_index, log_data, tx_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
      connection.query(
        insertStr,
        [
          log.ChainId,
          log.EventId,
          log.ProjectId,
          log.TxHash,
          log.ContractAddres,
          log.Topic,
          log.BlockNumber,
          log.BlockHash,
          log.TxIndex,
          log.LogIndex,
          log.LogData,
          log.TxTimestamp,
        ],
        (queryError, result) => {
          connection.release();

          if (queryError) {
            if (isDuplicateEntryError(queryError)) {
              console.log("Skip duplicate mos log, txHash:", log.TxHash, "err:", queryError.message);
              callback?.(null, 0);
              resolve(0);
              return;
            }

            callback?.(queryError);
            reject(queryError);
            return;
          }

          const insertId = (result as ResultSetHeader).insertId;
          callback?.(null, insertId);
          resolve(insertId);
        },
      );
    });
  });
};

function isDuplicateEntryError(error: Error): boolean {
  const mysqlError = error as Error & { code?: string; errno?: number };
  return mysqlError.code === "ER_DUP_ENTRY" || mysqlError.errno === 1062;
}

export const getSyncCursor = async (chainId: string, address: string): Promise<string> => {
  if (!pool) {
    return "";
  }
  await ensureSyncCursorTable();

  return new Promise((resolve, reject) => {
    pool.getConnection((error, connection) => {
      if (error) {
        reject(error);
        return;
      }

      connection.query(
        "SELECT cursor FROM sol_sync_cursor WHERE chain_id = ? AND address = ? LIMIT 1",
        [chainId, address],
        (queryError, rows) => {
          connection.release();
          if (queryError) {
            reject(queryError);
            return;
          }

          const row = (rows as RowDataPacket[])[0];
          resolve(row?.cursor || "");
        },
      );
    });
  });
};

export const saveSyncCursor = async (chainId: string, address: string, cursor: string): Promise<void> => {
  if (!pool || !cursor) {
    return;
  }
  await ensureSyncCursorTable();

  return new Promise((resolve, reject) => {
    pool.getConnection((error, connection) => {
      if (error) {
        reject(error);
        return;
      }

      connection.query(
        `INSERT INTO sol_sync_cursor (chain_id, address, cursor)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE cursor = VALUES(cursor), updated_at = CURRENT_TIMESTAMP`,
        [chainId, address, cursor],
        (queryError) => {
          connection.release();
          if (queryError) {
            reject(queryError);
            return;
          }
          resolve();
        },
      );
    });
  });
};

export const saveSyncDeadLetter = async (
  chainId: string,
  address: string,
  txHash: string,
  stage: string,
  error: Error,
  retryable: boolean,
): Promise<void> => {
  if (!pool) {
    return;
  }
  await ensureSyncDeadLetterTable();

  return new Promise((resolve, reject) => {
    pool.getConnection((connectionError, connection) => {
      if (connectionError) {
        reject(connectionError);
        return;
      }

      connection.query(
        `INSERT INTO sol_tx_dead_letter
          (chain_id, address, tx_hash, stage, error_name, error_message, retryable)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          error_name = VALUES(error_name),
          error_message = VALUES(error_message),
          retryable = VALUES(retryable),
          occurrences = occurrences + 1,
          updated_at = CURRENT_TIMESTAMP`,
        [chainId, address, txHash, stage, error.name, error.message, retryable ? 1 : 0],
        (queryError) => {
          connection.release();
          if (queryError) {
            reject(queryError);
            return;
          }
          resolve();
        },
      );
    });
  });
};

async function ensureSyncCursorTable(): Promise<void> {
  if (syncCursorTableReady || !pool) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    pool.getConnection((error, connection) => {
      if (error) {
        reject(error);
        return;
      }

      connection.query(
        `CREATE TABLE IF NOT EXISTS sol_sync_cursor (
          chain_id VARCHAR(64) NOT NULL,
          address VARCHAR(128) NOT NULL,
          cursor VARCHAR(128) NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (chain_id, address)
        )`,
        (queryError) => {
          connection.release();
          if (queryError) {
            reject(queryError);
            return;
          }
          syncCursorTableReady = true;
          resolve();
        },
      );
    });
  });
}

async function ensureSyncDeadLetterTable(): Promise<void> {
  if (syncDeadLetterTableReady || !pool) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    pool.getConnection((error, connection) => {
      if (error) {
        reject(error);
        return;
      }

      connection.query(
        `CREATE TABLE IF NOT EXISTS sol_tx_dead_letter (
          chain_id VARCHAR(64) NOT NULL,
          address VARCHAR(128) NOT NULL,
          tx_hash VARCHAR(128) NOT NULL,
          stage VARCHAR(64) NOT NULL,
          error_name VARCHAR(128) NOT NULL,
          error_message TEXT NOT NULL,
          retryable TINYINT(1) NOT NULL DEFAULT 0,
          occurrences INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (chain_id, address, tx_hash, stage)
        )`,
        (queryError) => {
          connection.release();
          if (queryError) {
            reject(queryError);
            return;
          }
          syncDeadLetterTableReady = true;
          resolve();
        },
      );
    });
  });
}
