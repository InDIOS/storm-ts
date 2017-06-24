import { Connection } from '../connection';
import { keys, eachKey } from '../utils';
import {
	Adapter, AdapterDefinition, ConditionOptions,
	FieldOptions, ConnectionOptions, IndexOption
} from '../types';
import { MongoClient, ObjectID, Db, Collection } from 'mongodb';

class MongoDB extends Adapter {

	client: Db;
	readonly name: string;
	private _models: { [key: string]: AdapterDefinition };

  constructor(settings: ConnectionOptions) {
    super();
		this._models = {};
		this.name = 'mongodb';
		let auth = settings.username && settings.password ? `${settings.username}:${settings.password}@` : '';
		let url = settings.url || `mongodb://${auth}${settings.host}:${settings.port}/${settings.database}`;
		MongoClient.connect(url, settings, (err, db) => {
			if (err) {
				console.log(err);
				throw err;
			} else {
				this.client = db;
			}
		});
	}

	async collection(modelName: string) {
		if (!this.client) {
			throw new Error(`Can't establish a connection with the server.`);
		}
		if (this.client.collection) {
			return await new Promise<Collection>((resolve, reject) => {
				this.client.collection(modelName, (err, collection) => {
					if (err) {
						reject(err);
					} else {
						resolve(collection);
					}
				});
			});
		} else {
			let collection = await this.client.createCollection(modelName);
			return collection;
		}
	}

	define(definition: AdapterDefinition) {
		let modelName = definition.model.modelName;
		this._models[modelName] = definition;
		this.collection(modelName).then(({ createIndexes }) => {
			let indexes: { key: Object, name: string, unique?: boolean, background: boolean }[] = [];
			eachKey(definition.properties, prop => {
				let property = definition.properties[prop];
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
			});
			createIndexes(indexes).catch(err => console.log(err));
		});
	}

	defineProperty(modelName: string, field: string, params: FieldOptions): void {
		this._models[modelName].properties[field] = params;
	}

	ensureIndex(modelName: string, fields: string | string[], params?: string | boolean | IndexOption): Promise<void> {
		let name = '', isUnique = false;
		let indexes: { key: Object, name: string, unique?: boolean, background: boolean }[] = [];
		return this.collection(modelName).then(({ createIndexes }) => {
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
			return createIndexes(indexes);
		}).then(() => { });

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
		let [{ field }] = this._models[modelName].pKeys;
		return this.count(modelName, { where: { [field]: id } }).then(count => count !== 0);
	}

	count(modelName: string, query: ConditionOptions): Promise<number> {
		let opts = {};
		opts['skip'] = query.skip;
		opts['limit'] = query.limit;
		let conds = buildWhere(query.where);
		return this.collection(modelName).then(({ count }) => count(conds, opts));
	}

	create<M, N>(modelName: string, data: M): Promise<N> {
		let [{ field }] = this._models[modelName].pKeys;
		delete data[field];
		return this.collection(modelName).then(({ insertOne }) => {
			return insertOne(data, { w: 1 });
		}).then(({ ops }) => {
			let record = this.fromDatabase<M, N>(modelName, ops && ops[0] && ops[0]._id ? ops[0] : {});
			return record;
		});
	}

	save<M, N>(modelName: string, data: M): Promise<N> {
		let [{ field }] = this._models[modelName].pKeys;
		let id = data[field];
		delete data[field];
		id = getObjectId(id);
		return this.collection(modelName).then(({ updateOne }) => {
			return updateOne({ [field]: id }, data, { w: 1 });
		}).then(({ upsertedId: { _id } }) => {
			return this.find<M>(modelName, { where: { [field]: _id } });
		}).then(records => {
			return this.fromDatabase<M, N>(modelName, records[0]);
		});
	}

	find<M>(modelName: string, query: ConditionOptions): Promise<M[]> {
		return this.collection(modelName).then(({ findOne }) => {
			let [{ field }] = this._models[modelName].pKeys;
			let conds = buildWhere(query.where);
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
				includes[field] = 1;
				if (inc > exc) {
					fields = includes;
				} else {
					fields = excludes;
				}
			}
			let options = {};
			delete query.where;
			delete query.fields;
			eachKey(query, key => { options[key] = query[key]; });
			options['fields'] = fields;
			return findOne<Object[]>(conds, options);
		}).then(result => {
			result = result.map(record => this.fromDatabase<Object, M>(modelName, record));
			return result;
		});
	}

	update<M, N>(modelName: string, query: ConditionOptions, data: M): Promise<N[]> {
		let [{ field }] = this._models[modelName].pKeys;
		delete data[field];
		let conds = buildWhere(query.where);
		if (conds['_id']) {
			conds['id'] = getObjectId(conds['_id'].toString());
			delete conds['_id'];
		}
		return this.find<M>(modelName, query).then(records => {
			return this.collection(modelName)
				.then(({ updateMany }) => {
					return updateMany(conds, { '$set': data }, { w: 1 });
				}).then(({result}) => {
					if (result.ok === 1 && result.n === result.nModified) {
						return records.map(record => record[field]);
					} else {
						return [];
					}
				});
		}).then(records => {
			return records.length ? this.find<N>(modelName, { where: { [field]: { in: records } } }) : [];
		});
	}

	updateOrCreate<M, N>(modelName: string, query: ConditionOptions, data: M): Promise<N[]> {
		let [{ field }] = this._models[modelName].pKeys;
		if (!data[field]) {
			return this.create<M, N>(modelName, data).then(record => [record]);
		} else {
			let id = getObjectId(data[field].toString());
			delete data[field];
			return this.collection(modelName).then(({ findOneAndUpdate }) => {
				let options = { upsert: true, returnOriginal: false };
				return findOneAndUpdate({ [field]: id }, { $set: data }, options);
			}).then(({ value }) => value);
		}
	}

	remove(modelName: string, query: ConditionOptions): Promise<boolean> {
		let conds = buildWhere(query.where);
		return this.collection(modelName)
			.then(({ deleteMany }) => deleteMany(conds))
			.then(({ deletedCount }) => deletedCount !== 0);
	}

	removeById(modelName: string, id: string | Object): Promise<boolean> {
		let [{ field }] = this._models[modelName].pKeys;
		return this.remove(modelName, { where: { [field]: getObjectId(id.toString()) } });
	}

	removeAll(modelName: string): Promise<void> {
		this.remove(modelName, {}).catch(err => console.log(err));
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
		let [{ field }] = this._models[modelName].pKeys;
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
		clean[field] = data[field] || data['_id'];
		return <N>clean;
  }
  
  static initialize(connection: Connection, done: Function) {
    if (!MongoClient) {
      done();
    } else {
      let { settings } = connection;
      if (!settings.url) {
        settings.host = settings.host || 'localhost';
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