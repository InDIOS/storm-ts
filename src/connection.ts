import { join } from 'path';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';
import { eachKey, keys, getIdType } from './utils';
import { GenerateModel, Entity } from './model';
import { ConnectionOptions, ModelOptions, Definition, Adapter, FieldOptions, ConditionOptions } from './types';

export class Connection extends EventEmitter {

	private name: string;
	models: { [key: string]: typeof Entity };
	adapter: Adapter;
	connected: boolean;
	definitions: Definition;
	settings: ConnectionOptions;

	constructor(settings: ConnectionOptions) {
		super();
		this.models = {};
		this.definitions = {};
		this.settings = settings;
		this.name = getAdapterName(settings.driver || '');

		let driver: typeof Adapter;
		try {
			if (this.settings.driver.match(/^\//)) {
				driver = <typeof Adapter>require(this.settings.driver);
			} else if (existsSync(join(__dirname, 'adapters', `${this.settings.driver}.js`))) {
				driver = <typeof Adapter>require(`./adapters/${this.settings.driver}`);
			} else {
				driver = <typeof Adapter>require(`caminte-${this.settings.driver}`);
			}
		} catch (err) {
			throw new Error(`Adapter ${this.settings.driver} is not defined, try 'npm install ${this.settings.driver}'`);
		}

		driver.initialize(this, adapter => {
			if (!adapter) {
				throw new Error('Adapter is not defined correctly: it should create `adapter` member of connection.');
			}

			this.adapter = adapter;
			this.adapter['log'] = (statement: string, start: string) => {
				this.log(statement, start);
			};

			this.adapter['logger'] = (statement: string) => {
				let time = Date.now().toString();
				return (stmt?: string) => {
					this.log(stmt || statement, time);
				};
			};

			let state = getState(this);
			if (state instanceof Error) {
				this.emit('error', state);
			} else {
				this.connected = true;
				this.emit('connected');
			}
		});
	}

	defineModel(targetModel: typeof Entity, modelSettings: ModelOptions) {
		let modelName = targetModel.modelName;
		if (!modelName) {
			throw new Error('Model require a name');
		}

		let properties = modelSettings.fields;
		if (!modelSettings.primaryKeys.length) {
			modelSettings.primaryKeys.push({ field: 'id', generated: true });
			properties['id'] = properties['id'] || { type: getIdType(this.adapter.name) };
		}
		this.definitions[modelName] = { properties, pKeys: modelSettings.primaryKeys };

		let genModel = GenerateModel(targetModel, this, modelSettings);
		this.models[modelName] = genModel;
		this.adapter.define({ model: genModel, properties, pKeys: modelSettings.primaryKeys });

		if (modelSettings.relOneToOne) {
			let conn = this;
			let rels = keys(modelSettings.relOneToOne);
			for (let i = 0, l = rels.length; i < l; i++) {
				let { prop, fkey } = modelSettings.relOneToOne[rels[i]];
				targetModel.prototype[prop] = function (data) {
					let model = conn.models[rels[i]];
					if (!isDefined(conn, targetModel.modelName, fkey)) {
						let fieldOpt = { type: getIdType(conn.adapter.name) };
						conn.extendModel(targetModel.modelName, { [fkey]: fieldOpt });
					}

					let [{ field }] = this.rootModel.connection.definitions[rels[i]].pKeys;
					if (data) {
						return model.create(data).then(record => {
							this[fkey] = record[field];
							return record;
						});
					} else {
						return model.findById(this[fkey]);
					}
				};
			}
		}

		if (modelSettings.relOneToMany) {
			let conn = this;
			let rels = keys(modelSettings.relOneToMany);
			for (let i = 0, l = rels.length; i < l; i++) {
				let { prop, fkey } = modelSettings.relOneToMany[rels[i]];
				Object.defineProperty(targetModel.prototype, prop, {
					enumerable: false,
					configurable: true,
					get() {
						let model = conn.models[rels[i]];
						if (!isDefined(conn, model.modelName, fkey)) {
							let fieldOpt = { type: getIdType(conn.adapter.name) };
							conn.extendModel(model.modelName, { [fkey]: fieldOpt });
						}

						let [{ field }] = this.rootModel.connection.definitions[this.modelName].pKeys;
						let cond = { where: { [fkey]: this[field] } };

						let oneToManyRelation = (data) => {
							if (data) {
								return new model({ ...data, ...{ [fkey]: this[field] } });
							} else {
								return oneToManyRelation['find']({}).then(records => {
									let obj = this.toObject();
									obj[prop] = records.map(record => record.toObject());
									return obj;
								});
							}
						};

						oneToManyRelation['create'] = (data) => {
							return model.create({ ...<Object>data, ...{ [fkey]: this[field] } });
						};

						oneToManyRelation['find'] = (conditions: ConditionOptions) => {
							return model.find({ ...conditions, ...cond });
						};

						oneToManyRelation['update'] = (conditions: ConditionOptions, data) => {
							return model.update({ ...conditions, ...cond }, data);
						};

						oneToManyRelation['remove'] = (conditions: ConditionOptions) => {
							return model.remove({ ...conditions, ...cond });
						};

						return oneToManyRelation;
					}
				});
			}
		}

		return genModel;
	}

	extendModel(modelName: string, props: { [key: string]: FieldOptions }) {
		eachKey(props, field => {
			if (!isDefined(this, modelName, field)) {
				let definition = props[field];
				this.definitions[modelName].properties[field] = definition;
				this.models[modelName].registerProperty(field);
				if (this.adapter.defineProperty) {
					this.adapter.defineProperty(modelName, field, definition);
				}
			}
		});
	}

	automigrate() {
		return commonAuto(this, 'automigrate');
	}

	autoupdate() {
		return commonAuto(this, 'autoupdate');
	}

	isActual() {
		return commonAuto(this, 'isActual');
	}

	log(statement: string, text?: string) {
		this.emit('log', statement, text);
	}

	disconnect() {
		if (typeof this.adapter.disconnect === 'function') {
			this.connected = false;
			this.adapter.disconnect();
		}
	}
}

function isDefined(connection: Connection, modelName: string, field: string) {
	return !!connection.definitions[modelName].properties[field];
}

function getState(connection) {
	switch (connection.name) {
		case 'mysql':
		case 'mariadb':
			if (connection.client && connection.client._protocol) {
				if (connection.client._protocol._fatalError && connection.client._protocol._fatalError.fatal) {
					return connection.client._protocol._fatalError;
				}
			}
			break;
	}
	return true;
}

function getAdapterName(name: string) {
	name = name.toLowerCase();
	switch (name) {
		case 'sqlite':
			name = 'sql.js';
			break;
		case 'mysqldb':
		case 'mariadb':
			name = 'mysql';
			break;
		case 'mongo':
			name = 'mongodb';
			break;
		case 'oracle':
			name = 'oracledb';
			break;
		case 'rethink':
			name = 'rethinkdb';
		case 'pg':
		case 'postgres':
			name = 'pg-promise';
			break;
		default:
			name = 'memory';
			break;
	}
	return name;
}

async function commonAuto(connection: Connection, method: string) {
	if (connection.adapter.freezeSchema) {
		connection.adapter.freezeSchema();
	}
	try {
		if (connection.adapter[method]) {
			await connection.adapter[method]();
		}
	} catch (error) {
		connection.emit('error', error);
	}
}