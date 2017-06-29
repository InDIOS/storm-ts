import { Connection } from '../connection';
import { keys, eachKey } from '../utils';
import {
	Adapter, AdapterDefinition, ConditionOptions,
	FieldOptions, ConnectionOptions, IndexOption
} from '../types';
import { MongoClient, ObjectID, Db, Collection } from 'mongodb';

const deleteKeys = ['database', 'port', 'driver', 'host', 'username', 'password', 'url'];

class MongoDB extends Adapter {

	client: Db;
	settings: { [x: string]: any };
	urlConnection: string;
	readonly name: string;
	private _models: { [key: string]: AdapterDefinition };

	constructor(settings: ConnectionOptions) {
		super();
		this._models = {};
		this.name = 'mongodb';
		let auth = settings.username && settings.password ? `${settings.username}:${settings.password}@` : '';
		this.urlConnection = settings.url || `mongodb://${auth}${settings.host}:${settings.port}/${settings.database}`;
		deleteKeys.forEach(key => delete settings[key]);
		this.settings = settings;
	}

	async connect() {
		let db = await MongoClient.connect(this.urlConnection, this.settings);
		return db;
	}

	async collection(modelName: string) {
		try {
			if (!this.client) {
				this.client = await this.connect();
			}
		} catch (error) {
			let err = new Error(`Can't establish a connection with the server.`);
			err.stack = error.stack;
			return Promise.reject(err);
		}
		return new Promise<Collection>((resolve, reject) => {
			this.client.collection(modelName, { strict: true }, (err, collection) => {
				if (err) {
					resolve(this.client.createCollection(modelName));
				} else {
					resolve(collection);
				}
			});
		});
	}

	define(definition: AdapterDefinition) {
		let modelName = definition.model.modelName;
		this._models[modelName] = definition;
		this.collection(modelName).then(collection => {
			let indexes: { key: Object, name: string, unique?: boolean, background: boolean }[] = [];
			eachKey(definition.properties, prop => {
				let property = definition.properties[prop];
				if (property.unique || property.index) {
					let index = indexes.findIndex(i => i.name === property.index);
					if (~index) {
						indexes[index].key[prop] = 1;
						indexes[index].unique = typeof property.unique === 'boolean' ? property.unique : false;
					} else {
						let newIndex = {
							key: { [prop]: 1 },
							unique: typeof property.unique === 'boolean' ? property.unique : false,
							name: typeof property.index === 'string' ? property.index : `index_${prop}_field`,
							background: true
						};
						indexes.push(newIndex);
					}
				}
			});
			if (indexes.length > 0) {
				collection.createIndexes(indexes)/*.catch(err => console.log('Error Ocurred creating indexes', err))*/;
			}
		}).catch(err => console.log('Error Ocurred getting collection', err));
	}

	defineProperty(modelName: string, field: string, params: FieldOptions): void {
		this._models[modelName].properties[field] = params;
	}

	ensureIndex(modelName: string, fields: string | string[], params?: string | boolean | IndexOption): Promise<void> {
		let name = '', isUnique = false;
		let indexes: { key: Object, name: string, unique?: boolean, background: boolean }[] = [];
		return this.collection(modelName).then(coll => {
			if (Array.isArray(fields)) {
				setValues(fields.join('_'));
				indexes.push({
					key: fields.map(field => ({ [field]: 1 }))
						.reduce((prev, next) => Object.assign(prev, next)),
					unique: isUnique, name, background: true
				});
			} else {
				setValues(fields);
				indexes.push({ key: { [fields]: 1 }, unique: isUnique, name, background: true });
			}
			if (indexes.length > 0) {
				return coll.createIndexes(indexes);
			}
		})/*.catch(err => console.log(err))*/;

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

	exists(modelName: string, id: string | Object): Promise<boolean> {
		id = getObjectId(id.toString());
		let [{ pKey }] = this._models[modelName].pKeys;
		return this.count(modelName, { where: { [pKey === 'id' ? '_id' : pKey]: id } })
			.then(count => count !== 0)/*.catch(err => console.log(err))*/;
	}

	count(modelName: string, query: ConditionOptions): Promise<number> {
		let opts = {};
		opts['skip'] = query.skip;
		opts['limit'] = query.limit;
		let conds = buildWhere(query.where);
		return this.collection(modelName)
			.then(({ count }) => count(conds, opts))/*.catch(err => console.log(err))*/;
	}

	create<M, N>(modelName: string, data: M): Promise<N> {
		let [{ pKey }] = this._models[modelName].pKeys;
		delete data[pKey];
		return this.collection(modelName).then(coll => {
			return coll.insertOne(data, { w: 1 });
		}).then(({ ops }) => {
			let record = this.fromDatabase<M, N>(modelName, ops && ops[0] && ops[0]._id ? ops[0] : {});
			return record;
		})/*.catch(err => console.log(err))*/;
	}

	save<M, N>(modelName: string, data: M): Promise<N> {
		let [{ pKey }] = this._models[modelName].pKeys;
		let id = data[pKey];
		delete data[pKey];
		id = getObjectId(id.toString());
		return this.collection(modelName).then(coll => {
			return coll.updateOne({ [pKey === 'id' ? '_id' : pKey]: id }, data, { w: 1 });
		}).then(({ upsertedId: { _id } }) => {
			return this.find<M>(modelName, { where: { [pKey === 'id' ? '_id' : pKey]: _id } });
		}).then(records => {
			return this.fromDatabase<M, N>(modelName, records[0]);
		})/*.catch(err => console.log(err))*/;
	}

	find<M>(modelName: string, query: ConditionOptions): Promise<M[]> {
		return this.collection(modelName).then(coll => {
			let [{ pKey }] = this._models[modelName].pKeys;
			let conds = buildWhere(query.where);
			validID(conds);
			let fields: { [key: string]: number } = {};
			if (query.fields) {
				let includes: { [key: string]: number } = {};
				let excludes: { [key: string]: number } = {};
				let inc = 0, exc = 0;
				query.fields.split(' ').forEach(field => {
					let cleanField = field.replace('-', '');
					if (field.startsWith('-') && cleanField !== field) {
						excludes[cleanField] = 0;
						exc++;
					} else {
						includes[cleanField] = 1;
						inc++;
					}
				});
				includes[pKey] = 1;
				if (inc > exc) {
					fields = includes;
				} else {
					fields = excludes;
				}
			}
			let cursor = coll.find<Object>();

			if (query.hasOwnProperty('limit')) {
				cursor = cursor.limit(query.limit);
			}

			if (query.hasOwnProperty('skip')) {
				cursor = cursor.skip(query.skip);
			}

			if (query.hasOwnProperty('order')) {
				let sort = [];
				for (var key in query.order) {
					sort.push([key, query.order[key]]);
				}
				cursor = cursor.sort(sort);
			}
			return cursor
				.filter(conds)
				.project(fields).toArray();
		}).then(result => {
			result = result.map(record => this.fromDatabase<Object, M>(modelName, record));
			return result;
		})/*.catch(err => console.log(err))*/;
	}

	update<M, N>(modelName: string, query: ConditionOptions, data: M): Promise<N[]> {
		let [{ pKey }] = this._models[modelName].pKeys;
		delete data[pKey];
		let conds = buildWhere(query.where);
		validID(conds);
		return this.find<M>(modelName, query).then(records => {
			return this.collection(modelName)
				.then(coll => {
					return coll.updateMany(conds, { '$set': data }, { w: 1 });
				}).then(({ result }) => {
					if (result.ok === 1 && result.n > 0) {
						return records.map(record => record[pKey]);
					} else {
						return [];
					}
				})/*.catch(err => console.log(err))*/;
		}).then(records => {
			return records && records.length ? this.find<N>(modelName, { where: { [pKey]: { in: records } } }) : [];
		})/*.catch(err => console.log(err))*/;
	}

	updateOrCreate<M, N>(modelName: string, query: ConditionOptions, data: M): Promise<N[]> {
		let [{ pKey }] = this._models[modelName].pKeys;
		let _id = pKey === 'id' ? '_id' : pKey;
		if (!data[_id]) {
			return this.create<M, N>(modelName, data).then(record => [record]);
		} else {
			let id = getObjectId(data[_id].toString());
			delete data[_id];
			return this.collection(modelName).then(coll => {
				let options = { upsert: true, returnOriginal: false };
				return coll.findOneAndUpdate({ [_id]: id }, { $set: data }, options);
			}).then(({ value }) => value)/*.catch(err => console.log(err))*/;
		}
	}

	remove(modelName: string, query: ConditionOptions): Promise<boolean> {
		let conds = buildWhere(query.where);
		validID(conds);
		return this.collection(modelName)
			.then(coll => coll.deleteMany(conds))
			.then(({ deletedCount }) =>  deletedCount !== 0)
			/*.catch(err => console.log(err))*/;
	}

	removeById(modelName: string, id: string | Object): Promise<boolean> {
		let [{ pKey }] = this._models[modelName].pKeys;
		return this.remove(modelName, { where: { [pKey === 'id' ? '_id' : pKey]: getObjectId(id.toString()) } });
	}

	removeAll(modelName: string): Promise<void> {
		this.remove(modelName, {})/*.catch(err => console.log(err))*/;
		return;
	}

	protected toDatabase<M>(data: M, pKey: string) {
		if (data[pKey] === null || data[pKey] === void 0) {
			delete data[pKey];
		}
		eachKey(data, field => {
			if (data[field] instanceof Date) {
				data[field] = data[field].getTime();
			}
			if (data[field] === void 0) {
				data[field] = null;
			}
		});
		return data;
	}

	protected fromDatabase<M, N>(modelName: string, data: M): N {
		let clean = {};
		let [{ pKey }] = this._models[modelName].pKeys;
		let { properties } = this._models[modelName];
		eachKey(data, key => {
			if (properties[key]) {
				if (properties[key].type === 'date') {
					if (data[key]) {
						clean[key] = new Date(data[key]);
					} else {
						clean[key] = data[key];
					}
				} else {
					clean[key] = data[key];
				}
			}
		});
		clean[pKey] = data[pKey] || data['_id'];
		return <N>clean;
	}

	static initialize(connection: Connection, done: Function) {
		if (!MongoClient) {
			done();
		} else {
			let { settings } = connection;
			if (!settings.url) {
				settings.host = settings.host || '127.0.0.1';
				settings.port = settings.port || 27017;
				settings.database = settings.database || 'test';
			}
			done(new MongoDB(settings));
		}
	}
}

export = MongoDB;

function getObjectId(id: string) {
	let objectId: ObjectID = null;
	if (typeof id === 'string') {
		objectId = new ObjectID(id);
	}
	return objectId;
}

function validID(conds: Object) {
	if (conds['id']) {
		conds['_id'] = typeof conds['id'] === 'string' ? getObjectId(conds['id']) : conds['id'];
		delete conds['id'];
	}
}

function buildWhere(filter: Object) {
	let query = {};
	eachKey(filter, option => {
		let cond = filter[option];
		let spec = '';

		if (option === 'or') {
			let arrcond = [];
			eachKey(cond, key => {
				let nval = {};
				nval[key] = cond[key];
				arrcond.push(nval);
			});
			query['$or'] = arrcond;
			return;
		}

		if (typeof cond === 'object') {
			spec = keys(cond)[0];
			cond = cond[spec];
		}

		if (spec) {
			if (spec === 'between') {
				query[option] = { $gte: cond[0], $lte: cond[1] };
			} else {
				query[option] = {};
				spec = spec === 'inq' ? 'in' : spec;
				spec = spec === 'like' ? 'regex' : spec;
				if (spec === 'nlike') {
					query[option]['$not'] = new RegExp(cond, 'i');
				} else {
					query[option]['$' + spec] = cond;
				}
			}
		} else {
			if (cond === null) {
				query[option] = { $type: 10 };
			} else {
				query[option] = cond;
			}
		}
	});
	return query;
}