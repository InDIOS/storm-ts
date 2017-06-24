import { parse } from 'url';
import BaseSQL = require('../baseSQL');
import { Connection } from '../connection';
import {
	getConnection, IConnection, OBJECT,
	IConnectionAttributes, createPool
} from 'oracledb';

class OracleDB extends BaseSQL {

	name: string;
	client: IConnection;

	constructor(client: IConnection) {
		let name = 'oracle';
		super('oracle');
		this.name = name;
		this.client = client;
	}

	protected toDatabaseDate(date: Date) {
		// TO-DO
		throw new Error('Method not implemented.');
	}

	protected query<T>(statement: string, values?: (string | number | boolean)[]): Promise<T[]> {
		return new Promise<T[]>((resolve, reject) => {
			this.client.execute(statement, values, { outFormat: OBJECT }, (err, results) => {
				if (err) {
					this.client.rollback();
					reject(err);
				} else if (results.rows) {
					this.client.commit();
					resolve(<T[]>results.rows);
				} else {
					this.client.commit();
					resolve([]);
				}
			});
		});
	}

	static initialize(connection: Connection, done: Function) {
		if (!getConnection) {
			done();
		} else {
			let config: IConnectionAttributes = null;
			let { settings } = connection;

			if (settings.url) {
				let uri = parse(settings.url, true);
				settings.host = uri.hostname;
				settings.port = parseInt(uri.port) || 1521;
				[settings.database] = uri.pathname.split('/');
				[settings.username, settings.password] = uri.auth && uri.auth.split(':');
			}

			config = {
				poolAlias: <string>settings.poolAlias,
				externalAuth: <boolean>settings.externalAuth,
				stmtCacheSize: <number>settings.stmtCacheSize,
				connectString: `${settings.host || 'localhost'}:${settings.port || 1521}/${settings.database || 'test'}`
			};

			if (settings.username && settings.password) {
				config.user = settings.username;
				config.password = settings.password;
			}

			if (settings.pool) {
				createPool(config, (err, pool) => {
					if (err) {
						console.log(err);
						done();
					} else {
						pool.getConnection(connect(done));
					}
				});
			} else {
				getConnection(config, connect(done));
			}
		}
	}

	dataTypes(propType: string) {
		switch (propType) {
			case 'string':
			case 'varchar':
			case 'text':
			case 'json':
			case 'uuid':
				return 'VARCHAR2';
			case 'blob':
			case 'bytes':
				return 'BLOB';
			case 'boolean':
			case 'tinyint':
			case 'number':
			case 'int':
				return 'NUMBER';
			case 'double':
				return 'BINARY_DOUBLE';
			case 'real':
			case 'float':
				return 'BINARY_FLOAT';
			case 'date':
				return 'DATE';
			case 'timestamp':
			case 'timeuuid':
				return 'TIMESTAMP';
			case 'array':
				return 'ARRAY';
			default:
				return propType;
		}
	}
}

function connect(done: Function) {
	return (err: any, conn: IConnection) => {
		if (err) {
			console.log(err);
			done();
		} else {
			done(new OracleDB(conn));
		}
	};
}
