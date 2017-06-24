import { readFileSync, writeFile, existsSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { Connection } from '../connection';
import BaseSQL = require('../baseSQL');
import { Database } from 'sql.js';

class SQLite extends BaseSQL {

	readonly name: string;
	private client: Database;

	constructor(client: Database) {
		let name = 'sqlite';
		super(name);
		this.name = name;
		this.client = client;
	}

	begin() {
		this.client.run('BEGIN');
	}

	commit() {
		this.client.run('COMMIT');
		writeDB(this.client, err => {
			if (err) {
				console.log(err);
			}
		});
	}

	rollback() {
		this.client.run('ROLLBACK');
	}

	protected query<T>(statement: string, values?: (string | number | boolean)[]): Promise<T[]> {
		return new Promise<T[]>((resolve, reject) => {
			try {
				this.begin();
				let stmt = this.client.prepare(statement);
				if (values) {
					stmt.bind(values);
				}
				let rows: T[] = [];
				while (stmt.step()) {
					let row: T = <T><any>stmt.getAsObject();
					rows.push(row);
				}
				if (statement.includes('INSERT')) {
					rows.push(<T><any>this.client.exec('SELECT last_insert_rowid()')[0].values[0][0]);
				} else if (statement.match(/UPDATE|DELETE/)) {
					rows.push(<T><any>this.client.exec('SELECT changes()')[0].values[0][0]);
				}
				this.commit();
				stmt.free();
				resolve(rows);
			} catch (error) {
				this.rollback();
				reject(error);
			}
		});
	}

	toDatabaseDate(date: Date) {
		return date.getTime();
	}

	dataTypes(propType: string) {
		switch (propType) {
			case 'text':
			case 'uuid':
			case 'string':
			case 'varchar':
				return `TEXT`;
			case 'blob':
			case 'json':
			case 'bytes':
			case 'array':
				return `NONE`;
			case 'real':
			case 'float':
			case 'double':
				return `REAL`;
			case 'date':
			case 'number':
			case 'timeuuid':
			case 'timestamp':
				return `NUMERIC`;
			case 'int':
			case 'boolean':
			case 'tinyint':
				return `INTEGER`;
			default:
				return propType;
		}
	}

	disconnect() {
		writeDB(this.client, err => {
			if (err) {
				console.log(err);
			}
		});
		this.client.close();
	}

	static initialize(connection: Connection, done: Function) {
		if (!Database) {
			done();
		} else {
			let { database } = connection.settings;
			let db = new Database();
			if (database && database !== ':memory:') {
				database = resolvePath(database);
				db = new Database(existsSync(database) ? readFileSync(database) : null);
			}
			db['dirname'] = database;
			db.run('PRAGMA encoding = "UTF-8"');
			writeDB(db, err => {
				if (err) {
					console.log(err);
				}
			});
			done(new SQLite(db));
		}
	}
}

export = SQLite;

function writeDB(db: Database, done: (err) => void) {
	let dir: string = db['dirname'];
	if (dir && dir !== ':memory:') {
		writeFile(dir, db.export(), done);
	}
}