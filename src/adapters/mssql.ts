import { Connection } from '../connection';
import BaseSQL = require('../baseSQL');
import { parse } from 'url';
import {
	Connection as MSConnection,
	config, Request, Transaction
} from 'mssql';
import { fixZero } from "../utils";

class MSSql extends BaseSQL {

	readonly name: string;
	client: MSConnection;

	constructor(client: MSConnection) {
		let name = 'mssql';
		super(name);
		this.name = name;
		this.client = client;
	}

	toDatabaseDate(date: Date) {
		return `${[
			date.getFullYear(),
			fixZero(date.getMonth() + 1),
			fixZero(date.getDate())
		].join('')} ${[
			fixZero(date.getHours()),
			fixZero(date.getMinutes()),
			fixZero(date.getSeconds())
		].join(':')}`;
	}

	protected query<T>(statement: string, values?: (string | number | boolean)[]): Promise<T[]> {
		let tx = new Transaction(this.client);
		return tx.begin().then(() => {
			let req = new Request(tx);
			if (values) {
				values.forEach((value, i) => {
					req.input(`${i}`, value);
				});
			}
			return req.query<T>(statement).then(records => {
				if (statement.match(/UPDATE|DELETE/)) {
					records = <any>[1];
				} else if (statement.includes('INSERT')) {
					records = <any>req.query<number>('SELECT @@IDENTITY');
				}
				return records;
			});
		}).then(records => {
			return tx.commit().then(() => records);
		}).catch(err => {
			return tx.rollback().then(() => []);
		});
	}

	disconnect() {
		this.client.close();
	}

	static initialize(connection: Connection, done: Function) {
		if (!MSConnection) {
			done();
		} else {
			let config: config;
			let { settings } = connection;
			if (settings.url) {
				let inst = '';
				let uri = parse(settings.url, true);
				settings.host = uri.hostname;
				settings.port = parseInt(uri.port) || 1433;
				[settings.database, inst] = uri.pathname.split('/');
				[settings.username, settings.password] = uri.auth && uri.auth.split(':');
				config = {
					port: settings.port,
					server: settings.host,
					user: settings.username,
					domain: uri.query.domain,
					driver: uri.query.driver,
					stream: uri.query.stream,
					database: settings.database,
					password: settings.password,
					requestTimeout: uri.query.requestTimeout,
					connectionTimeout: uri.query.connectionTimeout,
					pool: {
						max: uri.query.poolMax,
						min: uri.query.poolMin,
						idleTimeoutMillis: uri.query.idleTimeout
					},
					options: {
						instanceName: inst,
						useUTC: uri.query.useUTC,
						appName: uri.query.appName,
						encrypt: uri.query.encrypt,
						tdsVersion: uri.query.tsdVersion,
						trustedConnection: uri.query.trustedConnection,
						abortTransactionOnError: uri.query.abortTransactionOnError
					}
				};
			} else {
				let opt = {
					user: settings.username,
					server: settings.host || 'localhost',
					driver: <string>settings.driver || 'tedious',
					pool: {
						max: <number>settings.poolMax,
						min: <number>settings.poolMin,
						idleTimeoutMillis: <number>settings.idleTimeout
					}
				};
				delete settings.host;
				delete settings.poolMax;
				delete settings.poolMin;
				delete settings.username;
				delete settings.idleTimeout;
				config = { ...settings, ...opt };
				config.database = settings.database || 'test';
			}
			let conn = new MSConnection(config, err => console.log(err));
			done(new MSSql(conn));
		}
	}
}

export = MSSql;