import mysql from "mysql2";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { Log } from '../model'

export let db:mysql.Connection;
export let pool:mysql.Pool;

export function initDb(user:string, psw:string, database:string, host:string, port:number) {
    pool = mysql.createPool({
      user:user,
      password:psw,
      database:database,
      host:host,
      port:port,
    })
}

export const insertMos = (log: Log, callback: Function) => {
    pool.getConnection((error, connection) => {
      if (error) {
        connection.release();
        callback(error)
      } else {
        const insertStr = "INSERT INTO mos (chain_id, event_id, project_id, tx_hash, contract_address, topic, block_number, block_hash, tx_index, log_index, log_data, tx_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        connection.query(insertStr,
          [log.ChainId, log.EventId, log.ProjectId,  log.TxHash, log.ContractAddres, log.Topic, log.BlockNumber, 
                     log.BlockHash, log.TxIndex, log.LogIndex, log.LogData, log.TxTimestamp],
          (error, result) => {
          if (error) {
            callback(error)
          } else {
            const insertId = (<ResultSetHeader> result).insertId;
            callback(null, insertId)
          }
        });
      }
      connection.release(); // 释放该链接，把该链接放回池里供其他人使用
    });
};
