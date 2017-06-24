import { parse } from 'url';
import { ClientConfig } from 'pg';
import { fixZero } from '../utils';
import BaseSQL = require('../baseSQL');
import * as pgpromise from 'pg-promise';
import { IDatabase } from 'pg-promise';
import { Connection } from '../connection';


class Postgres extends BaseSQL {

  readonly name: string;
  private client: IDatabase<(string | number | boolean)[]>;

  constructor(client: IDatabase<(string | number | boolean)[]>, options: ClientConfig) {
    let name = 'postgres';
    super(name);
    this.name = name;
    this.client = client;
    this.client.connect(options).then(({ none, done }) => {
      none(`CREATE DATABASE ${options.database} OWNER ${options.user} ENCODING 'UTF8'`)
        .then(() => done());
    }).catch(err => console.log(err));
  }

  protected query<T>(sql: string, values?: (string | number | boolean)[]): Promise<T[]> {
    return this.client.tx(({ any, batch }) => {
      if (sql.includes('INSERT')) {
        sql += ' RETURNING *';
      }
      let query = any(sql, values);
      return batch([query]);
    }).then(rows => {
      if (sql.match(/UPDATE|DELETE/)) {
        return [1];
      } else {
        return rows;
      }
    });
  }

  toDatabaseDate(date: Date) {
    return `${[
      date.getFullYear(),
      fixZero(date.getMonth() + 1),
      fixZero(date.getDate())
    ].join('-')} ${[
      fixZero(date.getHours()),
      fixZero(date.getMinutes()),
      fixZero(date.getSeconds())
    ].join(':')}`;
  }

  disconnect() {
    return;
  }

  static initialize(connection: Connection, done: Function) {
    if (!pgpromise) {
      done();
    } else {
      let { settings } = connection;
      if (settings.url) {
        let uri = parse(settings.url, true);
        settings.host = uri.hostname;
        settings.port = parseInt(uri.port) || 5432;
        settings.ssl = /(true|require)/.test(uri.query.ssl);
        settings.database = uri.pathname.replace(/^\//, '');
        [settings.username, settings.password] = uri.auth && uri.auth.split(':');
      }
      settings.ssl = settings.ssl || false;
      settings.port = settings.port || 5432;
      settings.host = settings.host || 'localhost';
      settings.database = settings.database || 'test';
      let options: ClientConfig = {
        ssl: settings.ssl,
        port: settings.port,
        host: settings.host,
        user: settings.username,
        debug: settings.debug,
        password: settings.password,
        database: settings.database
      };
      let db = pgpromise()(settings.url ? settings.url : {
        ...options, ...{
          poolIdleTimeout: <number>settings['poolIdleTimeout'] || 5000,
          poolSize: <number>(settings['poolSize'] && settings.pool ? settings['poolSize'] : 25)
        }
      });
      done(new Postgres(db, options));
    }
  }
}

export = Postgres;