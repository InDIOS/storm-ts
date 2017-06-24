import { fixZero } from '../utils';
import BaseSQL = require('../baseSQL');
import { Connection } from '../connection';
import {
  createConnection, IConnection, createPool,
  IPool, IConnectionConfig, IPoolConfig
} from 'mysql';

class MySQL extends BaseSQL {

  client: IPool | IConnection;

  constructor(client: IPool);
  constructor(client: IConnection);
  constructor(client: any) {
    let name = 'mysql';
    super(name);
    this.client = client;
    let dbName = this.client.config.database;
    this.client.query(`CREATE DATABASE ${dbName}`, err => { throw err; });
  }

  begin() {
    return new Promise<void>((resolve, reject) => {
      (<IConnection>this.client).beginTransaction(err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  commit() {
    return new Promise<void>((resolve, reject) => {
      (<IConnection>this.client).commit(err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  rollback() {
    return new Promise<void>((resolve, reject) => {
      (<IConnection>this.client).rollback(() => {
        resolve();
      });
    });
  }

  protected query<T>(statement: string, values?: (string | number | boolean)[]): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      this.begin().then(() => {
        this.client.query(statement, values, (err, results) => {
          if (err) {
            reject(err);
          } else {
            this.commit().then(() => {
              if (statement.includes('INSERT')) {
                resolve([results.insertId]);
              } else if (statement.match(/UPDATE|DELETE/)) {
                resolve([results.affectedRows]);
              } else {
                resolve(Array.isArray(results) ? results : [results]);
              }
            }).catch(() => {
              return this.rollback();
            });
          }
        });
      }).catch(() => {
        return this.rollback();
      });
    });
  }

  toDatabaseDate(date: Date) {
    return `${[
      date.getUTCFullYear(),
      fixZero(date.getUTCMonth() + 1),
      fixZero(date.getUTCDate())
    ].join('-')} ${[
      fixZero(date.getUTCHours()),
      fixZero(date.getUTCMinutes()),
      fixZero(date.getUTCSeconds())
    ].join(':')}`;
  }

  protected dataTypes(propType: string, precision?: number, scale?: number) {
    switch (propType) {
      case 'string':
      case 'varchar':
        return `VARCHAR(${precision || 255})`;
      case 'text':
      case 'json':
      case 'array':
        return `TEXT`;
      case 'uuid':
        return `VARCHAR(36)`;
      case 'blob':
      case 'bytes':
        return `BLOB`;
      case 'boolean':
      case 'tinyint':
        return `TINYINT(1)`;
      case 'number':
        return `BIGINT${precision ? `(${precision})` : ''}`;
      case 'int':
        return `INT${precision ? `(${precision})` : ''}`;
      case 'double':
        return `DOUBLE(${precision}, ${scale})`;
      case 'real':
        return `DECIMAL(${precision}, ${scale})`;
      case 'float':
        return `FLOAT(${precision}, ${scale})`;
      case 'date':
        return `DATETIME`;
      case 'timestamp':
        return 'TIMESTAMP';
      case 'timeuuid':
        return 'TIME';
      default:
        return propType;
    }
  }

  static initialize(connection: Connection, done: Function) {
    if (!createPool) {
      done();
    } else {
      let { settings } = connection;
      let connConfig: IConnectionConfig | IPoolConfig = {};
      connConfig.database = settings.database;
      connConfig.user = settings.username || 'root';
      connConfig.password = settings.password;
      connConfig.host = settings.host || 'localhost';
      connConfig.port = settings.port || 3306;
      connConfig.debug = settings.debug;
      connConfig.connectTimeout = <number>settings.connectTimeout;
      if (settings.pool) {
        (<IPoolConfig>connConfig).queueLimit = <number>settings.queueLimit || 0;
        (<IPoolConfig>connConfig).connectionLimit = <number>settings.connectionLimit || 10;
        (<IPoolConfig>connConfig).waitForConnections = <boolean>settings.waitForConnections || true;
        let client: IPool = createPool(connConfig);
        done(new MySQL(client));
      } else {
        let client: IConnection = createConnection(connConfig);
        done(new MySQL(client));
      }
    }
  }
}

export = MySQL;