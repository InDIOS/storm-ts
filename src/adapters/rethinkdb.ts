import { Connection } from '../connection';
import {
	ConnectionOptions, AdapterDefinition, IndexOption,
	Adapter, FieldOptions, ConditionOptions
} from '../types';
import { parse } from 'url';
import { eachKey, keys, selectFields } from '../utils';
import {
	connect, Connection as Conn,
	js, Operation, db, dbCreate, table,
	row, Expression, asc, desc
} from 'rethinkdb';

class RethinkDB extends Adapter {

	client: Conn;
	readonly name: string;
	private dbName: string;
	private _models: { [key: string]: AdapterDefinition };

  constructor(settings: ConnectionOptions) {
    super();
		this.name = 'rethinkdb';
		this._models = {};
		this.dbName = settings.database;
		connect({
			host: settings.host,
			port: settings.port,
			db: settings.database
		}, (err, client) => {
			if (err) {
				console.log(err);
				throw err;
			} else {
				this.client = client;
				db(this.dbName).tableList().run(this.client).then(() => {
					this.client.use(this.dbName);
				}, err => {
					if (err && /database(.*)does\s+not\s+exist/i.test(err.message)) {
						dbCreate(this.dbName)
							.run(this.client).then(() => {
								this.client.use(this.dbName);
							});
					}
				});
			}
		});
	}

	define(definition: AdapterDefinition): void {
		let { modelName } = definition.model;
		this._models[modelName] = definition;
		db(this.dbName).tableCreate(modelName)
			.run(this.client)
			.then(() => {
				let indexes: { keys: Array<Expression<any>>, name: string }[] = [];
				eachKey(definition.properties, prop => {
					let property = definition.properties[prop];
					let index = indexes.findIndex(i => i.name === property.index);
					if (~index) {
						indexes[index].keys.push(row(prop));
					} else {
						let newIndex = {
							keys: [row(prop)],
							name: typeof property.index === 'string' ? property.index : `index_${prop}_field`
						};
						indexes.push(newIndex);
					}
				});
				let promises = indexes.map(({ name, keys }) => {
					return table(modelName)
						.indexCreate(name, keys.length === 1 ? keys[0] : keys).run(this.client);
				});
				return Promise.all(promises);
			}).catch(err => console.log(err));
	}

	defineProperty(modelName: string, field: string, params: FieldOptions): void {
		this._models[modelName].properties[field] = params;
	}

	ensureIndex(modelName: string, fields: string | string[], params?: string | boolean | IndexOption): Promise<void> {
		let keys = [];
		let name = '', isUnique = false;
		if (Array.isArray(fields)) {
			setValues(fields.join('_'));
			keys = fields.map(val => row(val));
		} else {
			setValues(fields);
			keys = [row(fields)];
		}
		return table(modelName).indexCreate(name, keys)
			.run(this.client).then(() => { });

		function setValues(prop: string) {
			if (typeof params === 'string') {
				name = params;
			} else if (typeof params === 'boolean') {
				isUnique = params;
			} else if (typeof params === 'object') {
				name = params.name || `index_${prop}_field`;
				isUnique = !!params.unique;
			} else {
				name = `index_${prop}_field`;
			}
		}
	}

	exists(modelName: string, id: number | string): Promise<boolean> {
		return table(modelName).get(id).run(this.client).then(({ toArray }) => {
			return toArray().then(records => !!records.length);
		});
	}

	count(modelName: string, query: ConditionOptions): Promise<number> {
		return buildWhere(modelName, query.where || {}).count().run(this.client);
	}

	create<M, N>(modelName: string, data: M): Promise<N> {
		let [{ field }] = this._models[modelName].pKeys;
		return insert<M, N>(modelName, this.toDatabase(data, field), field)
			.then(records => this.fromDatabase(modelName, records[0]));
	}

	save<M, N>(modelName: string, data: M): Promise<N> {
		let [{ field }] = this._models[modelName].pKeys;
		return this.update(modelName, { where: { [field]: data[field] } }, data)
			.then(records => records[0]);
	}

	find<N>(modelName: string, query: ConditionOptions): Promise<N[]> {
		let [{ field }] = this._models[modelName].pKeys;
		let seq = buildWhere(modelName, query.where || {});

		if (query.fields) {
			let { properties } = this._models[modelName];
			seq = seq.withFields(...selectFields(query.fields, field, keys(properties)));
		}

		if (query.order) {
			eachKey(query.order, key => {
				seq = ~query.order[key] ? seq.orderBy(asc(key)) : seq.orderBy(desc(key));
			});
		} else {
			seq = seq.orderBy(asc(field));
		}

		if (query.skip) {
			seq = seq.skip(query.skip);
		}

		if (query.limit) {
			seq = seq.limit(query.limit);
		}

		return seq.run(this.client).then(({ toArray }) => {
			return toArray();
		}).then(records => {
			let { properties } = this._models[modelName];
			return records.map(data => {
				eachKey(data, field => {
					if (properties.hasOwnProperty(field) && properties[field].type === 'date') {
						data[field] = toUnixDate(data[field]);
					}
				});
				return this.fromDatabase(modelName, data);
			});
		});
	}

	update<M, N>(modelName: string, query: ConditionOptions, data: M): Promise<N[]> {
		let [{ field }] = this._models[modelName].pKeys;
		return buildWhere(modelName, query.where)
			.update(this.toDatabase(data, field), { returnChanges: true }).run(this.client)
			.then(({ changes }) => {
				return changes.map(record => this.fromDatabase(modelName, record.new_val));
			});
	}

	updateOrCreate<M, N>(modelName: string, query: ConditionOptions, data: M): Promise<N[]> {
		return this.find<M>(modelName, query)
			.then(records => {
				let [{ field }] = this._models[modelName].pKeys;
				return insert<M, N>(modelName, this.toDatabase(data, field), field, { conflict: 'replace' });
			});
	}

	remove(modelName: string, query: ConditionOptions): Promise<boolean> {
		return buildWhere(modelName, query.where)
			.delete().run(this.client)
			.then(({ deleted }) => !!deleted);
	}

	removeById(modelName: string, id: number | string): Promise<boolean> {
		let [{ field }] = this._models[modelName].pKeys;
		return this.remove(modelName, { where: { [field]: id } });
	}

	removeAll(modelName: string): Promise<void> {
		return table(modelName).delete()
			.run(this.client).then(() => { });
	}

	protected toDatabase<M>(data: M, pKey: string): M {
		if (data[pKey] === null || data[pKey] === void 0) {
			delete data[pKey];
		}
		eachKey(data, field => {
			if (data[field] instanceof Date) {
				data[field] = toUnixDate(data[field]);
			}
			if (data[field] === void 0) {
				data[field] = null;
			}
		});
		return data;
	}

	protected fromDatabase<M, N>(modelName: string, data: M): N {
		let clean = {};
		let [{ field }] = this._models[modelName].pKeys;
		let { properties } = this._models[modelName];
		eachKey(data, key => {
			if (properties[key]) {
				if (properties[key].type === 'date') {
					if (data[key]) {
						clean[key] = new Date(data[key] * 1000);
					} else {
						clean[key] = data[key];
					}
				} else {
					clean[key] = data[key];
				}
			}
		});
		clean[field] = data[field] || data['id'];
		return <N>clean;
  }
  
  static initialize(connection: Connection, done: Function) {
    if (!connect) {
      done();
    } else {
      let { settings } = connection;
      if (settings.url) {
        let uri = parse(settings.url);
        settings.host = uri.hostname;
        settings.port = parseInt(uri.port, 10);
        settings.database = uri.pathname.replace(/^\//, '');
        if (uri.auth) {
          [settings.username] = uri.auth.split(':');
          [, settings.password] = uri.auth.split(':');
        }
      } else {
        settings.host = settings.host || 'localhost';
        settings.port = settings.port || 28015;
        settings.database = settings.database || 'test';
      }
      done(new RethinkDB(settings));
    }
  }
}

export = RethinkDB;

function insert<M, N>(modelName: string, data: M, pKey: string, options?: Object) {
	options = options || {};
	options['returnChanges'] = true;
	return table(modelName).insert(data, options)
		.run(this.client).then(({ changes }) => {
			return changes.map(record => <N>record.new_val);
		});
}

function toUnixDate(date: Date) {
	return parseInt((Date.parse(date.toString()) / 1000).toFixed(0));
}

function buildWhere(tableName: string, where: { [key: string]: any }) {
	//Transform the given where clause on a rethinkdb query based.
	//Returns the respective sequence
	let { stringify } = JSON;
	let dbTable = table(tableName);
	let queryExtra: Operation<any>[] = [];
	let queryParts: Expression<boolean>[] = [];
	eachKey(where, field => {
		let cond = where[field];
		let allConds: [string, any][] = [];
		if (cond && typeof cond === 'object') {
			let keys = Object.keys(cond);
			for (let i = 0, l = keys.length; i < l; i++) {
				allConds.push([keys[i], cond[keys[i]]]);
			}
		}
		else {
			allConds.push(['field', cond]);
		}
		for (let i = 0, l = allConds.length; i < l; i++) {
			let [spec, cond] = allConds[i];
			if (cond instanceof Date) {
				cond = toUnixDate(cond);
			}
			switch (spec) {
				case 'field':
					queryParts.push(row(field).eq(cond));
					break;
				case 'between':
					queryParts.push(row(field).ge(cond[0]).and(row(field).le(cond[1])));
					break;
				case 'in':
				case 'inq':
					let expr = `(function(row){return ${stringify(cond)}.indexOf(row.${field}) >= 0})`;
					queryExtra.push(js(expr));
					break;
				case 'nin':
					let expr1 = `(function(row){return ${stringify(cond)}.indexOf(row.${field}) === -1})`;
					queryExtra.push(js(expr1));
					break;
				case 'gt':
					queryParts.push(row(field).gt(cond));
					break;
				case 'gte':
					queryParts.push(row(field).ge(cond));
					break;
				case 'lt':
					queryParts.push(row(field).lt(cond));
					break;
				case 'lte':
					queryParts.push(row(field).le(cond));
					break;
				case 'ne':
				case 'neq':
					queryParts.push(row(field).ne(cond));
					break;
			}
		}
	});

	let seq = dbTable.filter({});
	let query = queryParts.reduce((left, right) => left.and(right), null);

	if (query) {
		seq = seq.filter(query);
	}
	queryExtra.forEach(op => {
		seq = seq.filter(op);
	});

	return seq;
}
