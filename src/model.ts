import { inspect } from 'util';
import { Connection } from './connection';
import * as validators from './validators';
import { QueryBuilder } from './queryBuilder';
import { afterHook, beforeHook } from './hooks';
import { keys, eachKey, getIdType } from './utils';
import {
	ModelOptions, FieldOptions,
	Validation, ValidationOptions,
	Validator, ValidationError, ConditionOptions
} from './types';

const BASE_TYPES = [
	'string', 'boolean', 'number',
	'date', 'text', 'json', 'uuid'
];

export function GenerateModel(target: typeof Entity, connection: Connection, options: ModelOptions) {
	defineProp(target, '_hooks', {});
	defineProp(target, '_validations', []);

	target.prototype['_validations'] = options.validations;
	target.prototype['_hooks'] = options.hooks;

	let { properties } = connection.definitions[target.modelName];
	let modelproperties = keys(properties);
	modelproperties.forEach(target.registerProperty, target);

	return target;
}

function defineProp(obj: any, propName: string, propInitValue: any) {
	Object.defineProperty(obj.prototype, propName, {
		enumerable: false, configurable: true, writable: true, value: propInitValue
	});
}

export class Entity<M, N> {

	static modelName: string;
	static fromSchema: boolean;
	static connection: Connection;

	constructor(data: M) {
		this.initialize(data);
	}

	get rootModel(): typeof Entity {
		return <any>this.constructor;
	}

	get modelName() {
		return this.rootModel.modelName;
	}

	get validationErros(): ValidationError[] {
		return this['validationErrosList'];
	}

	private initialize(data: M) {
		let defaults = {};
		let { rootModel } = this;
		let { modelName: model } = this;
		let { properties }: { [key: string]: FieldOptions } = rootModel.connection.definitions[model];
		let fromSchema = data['_fromSchema'];
		delete data['_fromSchema'];
		let modelproperties: string[] = keys(fromSchema !== false ? properties : data);
		let descritors: PropertyDescriptorMap = {};

		eachKey(properties, prop => {
			let defValue = properties[prop].default;
			if (typeof defValue !== 'undefined') {
				defaults[prop] = typeof defValue === 'function' ? defValue() : defValue;
			}
		});

		['__query', '__data', '__dataWas']
			.forEach(prop => {
				descritors[prop] = {
					writable: true, configurable: true,
					enumerable: false, value: data[prop] || {}
				};
			});
		descritors['validationErrosList'] = {
			writable: true, configurable: true,
			enumerable: false, value: []
		};
		Object.defineProperties(this, descritors);

		modelproperties.forEach(property => {
			let hasDefaultValue = defaults.hasOwnProperty(property);
			let hasProperty = data[property] !== void 0;
			if (hasProperty || hasDefaultValue) {
				if (typeof data[property] === 'undefined') {
					this['__data'][property] = this['__dataWas'][property] = defaults[property];
				} else {
					this['__data'][property] = this['__dataWas'][property] = data[property];
				}
			} else {
				this['__data'][property] = this['__dataWas'][property] = null;
			}

			properties[property].type = properties[property].type || 'string';

			let type = properties[property].type;
			if (!~BASE_TYPES.indexOf(type)) {
				if (this['__data'][property] && typeof this['__data'][property] !== 'object') {
					try {
						this['__data'][property] = JSON.parse(this['__data'][property] + '');
					} catch (err) {
						console.log(`[Error] Property ${property} with value ${this['__data'][property]} cannot be converted to ${type}.`, err);
					}
				}
			}
		});
		afterHook('initialize', this);
	}

	static defineForeignKey(key: string) {
		let { definitions } = this.connection;
		if (definitions[this.modelName].properties[key]) {
			console.log(`Model ${this.modelName} already have a key named ${key}`);
			return;
		}
		let { models } = this.connection;
		models[this.modelName].registerProperty(key);
		definitions[this.modelName].properties[key] = { type: getIdType(this.connection.adapter.name) };
	}

	static registerProperty(prop: string) {
		let map: PropertyDescriptorMap = {};
		map[prop] = {
			get() {
				return this.__data[prop];
			},
			set(value) {
				this.__data[prop] = value;
			},
			enumerable: true,
			configurable: true
		};
		map[prop + '_was'] = {
			get() {
				return this.__dataWas[prop];
			}
		};
		Object.defineProperties(this.prototype, map);
	}

	static defineProperty(prop: string, params: FieldOptions) {
		let props = { [prop]: params };
		this.connection.extendModel(this.modelName, props);
	}

	static fieldTypeName(prop: string) {
		let typeName = '';
		let definition = this.connection.definitions[this.modelName];
		if (definition.properties[prop]) {
			typeName = definition.properties[prop].type;
		}
		return typeName;
	}

	static query<M>(method: string, conditions?: ConditionOptions) {
		return new QueryBuilder<M>(this, method, conditions);
	}

	static exists(id: string | number | Object) {
		if (isNotConnected(this.connection, this, 'exist', id)) {
			return;
		} else {
			if (!!id) {
				return this.connection.adapter.exists(this.modelName, id);
			} else {
				Promise.reject(new Error(`${this.modelName}.exists requires an id argument`));
			}
		}
	}

	static count(conditions: ConditionOptions) {
		if (isNotConnected(this.connection, this, 'exist', conditions)) {
			return;
		} else {
			return this.connection.adapter.count(this.modelName, conditions);
		}
	}

	static create<M, N>(data: M) {
		beforeHook('create', this.prototype);

		if (isNotConnected(this.connection, this, 'create', data)) {
			return;
		}

		let { adapter } = this.connection;
		let create = (model: M) => adapter.create<M>(this.modelName, forDataBase<M>(this, model));
		let { pKeys } = this.connection.definitions[this.modelName];
		let noId = pKeys.every(key => !!data[key.field]);
		if (data instanceof this && !noId) {
			return create(data.toObject<M>()).then(record => {
				return <N>(<any>(new this<M, N>(record)));
			});
		} else {
			let model = new this<M, N>(data);
			return model.validate().then(isValid => {
				return create(model.toObject<M>()).then(record => {
					eachKey(record, prop => {
						model['__data'][prop] = record[prop];
						model['__dataWas'][prop] = record[prop];
					});
					if (!isValid) {
						pKeys.forEach(key => { model[key.field] = null; });
					}
					return new Promise<N>((resolve, reject) => {
						resolve(<N>(<any>model));
						afterHook('create', this.prototype, model);
					});
				});
			});
		}
	}

	static find<M, N>(): QueryBuilder<N[]>;	
	static find<M, N>(conditions: ConditionOptions): Promise<N[]>;
	static find<M, N>(conditions?: ConditionOptions) {
		if (!conditions) {
			return this.query<N[]>('find');
		} else {
			if (isNotConnected(this.connection, this, 'find', conditions)) {
				return;
			} else {
				conditions = QueryBuilder.build(conditions, this.query<N[]>('find', conditions));
				let adapter = this.connection.adapter;
				return adapter.find<M>(this.modelName, conditions).then(records => {
					if (records) {
						let modelRecords = records.map(record => {
							record['_fromSchema'] = !conditions['fields'];
							return <N><any>new this<M, N>(record);
						});
						return modelRecords;
					}
				});
			}
		}
	}

	static findOne<M, N>(): QueryBuilder<N>;
	static findOne<M, N>(conditions: ConditionOptions): Promise<N>;
	static findOne<M, N>(conditions?: ConditionOptions) {
		if (isNotConnected(this.connection, this, 'findOne', conditions)) {
			return;
		} else {
			if (!conditions) {
				return this.find<M, N>(conditions).then(records => records[0]);
			} else {
				return this.find<M, N>().limit(1);
			}
		}
	}

	static findById<M, N>(): QueryBuilder<N>;
	static findById<M, N>(id: string | number | Object): Promise<N>;
	static findById<M, N>(id?: string | number | Object) {
		if (isNotConnected(this.connection, this, 'findById', id)) {
			return;
		} else {
			let { pKeys } = this.connection.definitions[this.modelName];
			let hasId = false;
			let where: Object = { where: { id } };
			if (typeof id === 'object') {
				hasId = pKeys.some(key => id[key.field]);
				where = hasId && { where: { ...id } }; 
			}
			let find = this.find<M, N>(where);
			if (find instanceof Promise) {
				return this.find<M, N>(where).then(records => records[0]);
			} else {
				let find = this.find<M, N>();
				eachKey(where['where'], id => { 
					find.where(id, where['where'][id]);
				});
				return find;
			}
		}
	}

	static update<M, N>(conditions: ConditionOptions, data: M): Promise<N[]> {
		beforeHook('update', this.prototype);
		if (isNotConnected(this.connection, this, 'update', conditions, data)) {
			return;
		}

		let adapter = this.connection.adapter;
		return adapter.update<M>(this.modelName, conditions, data)
			.then(records => {
				let modelRecords: N[] = [];
				if (records.length) {
					modelRecords = records.map(record => {
						let newRecord = <N>(<any>(new this<M, N>(record)));
						return newRecord;
					});
				}

				return new Promise<N[]>((resolve, reject) => {
					resolve(modelRecords);
					afterHook('update', this.prototype, modelRecords);
				});
			});
	}

	static updateOrCreate<M, N>(conditions: ConditionOptions, data: M) {
		if (isNotConnected(this.connection, this, 'updateOrCreate', conditions, data)) {
			return;
		} else {
			let adapter = this.connection.adapter;
			return adapter.updateOrCreate<N>(this.modelName, conditions, (<any>data));
		}
	}

	static remove(conditions: Object) {
		beforeHook('remove', this.prototype);
		if (isNotConnected(this.connection, this, 'remove', conditions)) {
			return;
		} else {
			return this.connection
				.adapter.remove(this.modelName, conditions)
				.then((removed) => {
					return new Promise<boolean>((resolve, reject) => {
						resolve(removed);
						afterHook('remove', this.prototype, removed);
					});
				});
		}
	}

	static removeById(id: string | number | Object) {
		if (isNotConnected(this.connection, this, 'removeById', id)) {
			return;
		} else {
			let { pKeys } = this.connection.definitions[this.modelName];
			let hasId = false;
			let where: Object = { where: { id } };
			if (typeof id === 'object') {
				hasId = pKeys.some(key => id[key.field]);
				where = hasId && { where: { ...id } };
			}
			return this.remove(where);
		}
	}

	static removeAll() {
		beforeHook('remove', this.prototype);
		if (isNotConnected(this.connection, this, 'removeAll')) {
			return;
		} else {
			return this.connection
				.adapter.removeAll(this.modelName)
				.then(() => {
					return new Promise<void>((resolve, reject) => {
						resolve();
						afterHook('remove', this.prototype);
					});
				});
		}
	}

	updateFields(data: M) {
		let Model = this.rootModel;
		eachKey(data, key => {
			this[key] = data[key];
		});
		return this.validate().then(isValid => {
			if (!isValid) {
				return <N>(<any>(this));
			} else {
				let where = {};
				let { pKeys } = Model.connection.definitions[this.modelName];
				pKeys.forEach(key => { where[key.field] = this[key.field];});
				return Model.update(where, forDataBase(Model, data))
					.then(records => {
						eachKey(data, key => {
							this['__dataWas'][key] = this['__data'][key];
						});
						return this.save();
					});
			}
		});
	}

	save() {
		beforeHook('save', this);
		let Model = this.rootModel;

		if (isNotConnected<M, N>(Model.connection, this, 'save')) {
			return;
		}
		let { pKeys } = Model.connection.definitions[this.modelName];
		if (pKeys.every(key => !!this[key.field])) {
			return Model.connection.adapter
				.save<M>(this.modelName, forDataBase<M>(Model, this.toObject<M>()))
				.then(record => {
					return new Promise<N>((resolve, reject) => {
						eachKey(record, key => {
							this[key] = record[key];
						});
						resolve(<N><any>this);
						afterHook('save', this, this);
					});
				});
		} else {
			return Model.create<M, N>(this.toObject<M>());
		}
	}

	validate() {
		beforeHook('validate', this);
		let validations: Validation[] = this['_validations'];
		let responses: Promise<boolean>[] = [];
		if (!validations.length) {
			responses.push(Promise.resolve(true));
		} else {
			validations.forEach(validation => {
				responses.push(validationFailed<M, N>(this, validation));
			});
		}
		return new Promise<boolean>(async (resolve, reject) => {
			let valid = await Promise.all(responses).then(res => {
				return res.every(value => value);
			});
			resolve(valid);
			afterHook('validate', this, valid);
		});
	}

	toObject<M>() {
		let data: M = <M>{};
		let modelProperties = keys(this.rootModel.connection.definitions[this.modelName].properties);
		let _data: Object = this['__data'];
		modelProperties.forEach(prop => {
			if (_data.hasOwnProperty(prop)) {
				data[prop] = this[prop];
			}
		});
		return data;
	}

	inspect(depth: number, options: Object) {
		const newOptions = Object.assign({}, options, {
			depth: options['depth'] === null ? null : options['depth'] - 1
		});
		return `${this.modelName} ${inspect(this['__data'], newOptions)}`;
	}

	toJSON() {
		return JSON.stringify(this.toObject<M>(), null, 2);
	}
}

function isNotConnected<M, N>(connection: Connection, model: typeof Entity | Entity<M, N>, action: string, ...args: any[]) {
	if (connection.connected) {
		return false;
	}
	connection.on('connected', () => {
		model[action].apply(model, args);
	});
	return true;
}

function forDataBase<M>(model: typeof Entity, data: M) {
	let result = <M>{};
	let isSQL = ['mysql', 'sqlite', 'sqlite3', 'firebird', 'memory'];
	eachKey(data, prop => {
		if (model.fieldTypeName(prop).toString().toLowerCase() === 'json' || Array.isArray(data[prop])) {
			if (!~isSQL.indexOf(model.connection.adapter.name)) {
				result[prop] = JSON.stringify(data[prop]);
			} else {
				result[prop] = data[prop];
			}
		} else {
			result[prop] = data[prop];
		}
	});
	return result;
}

let defaultMessages = {
	presence: `can't be blank`,
	length: {
		min: 'too short',
		max: 'too long',
		is: 'length is wrong'
	},
	format: `don't match the format`,
	common: {
		null: 'is null',
		blank: 'is blank',
		other: 'is invalid'
	},
	numericality: {
		'int': 'is not an integer',
		'number': 'is not a number'
	},
	inclusion: 'is not included in the list',
	exclusion: 'is reserved',
	uniqueness: 'is not unique'
};

function validationFailed<M, N>(model: Entity<M, N>, validation: Validation) {
	let field = validation.field;
	let conf = validation.options;
	let validationName: string = validation.options['validation'];

	if (typeof field !== 'string' || skipValidation<M, N>(model, conf, 'if') || skipValidation<M, N>(model, conf, 'unless')) {
		return Promise.resolve(false);
	}
	
	let validator: Validator = validators[validationName];
	return validator<M, N>(model, field, conf).then(kind => {
		if (typeof kind === 'boolean' && kind) {
			return kind;
		}
		let message: string = null;
		if (conf.message) {
			message = conf.message;
		}
		if (!message && defaultMessages[validationName]) {
			message = defaultMessages[validationName];
		}
		if (!message) {
			message = 'is invalid';
		}
		if (typeof kind === 'string' && kind) {
			kind = kind !== 'other' ? kind : 'other';
			if (message[kind]) {
				message = message[kind];
			} else if (defaultMessages.common[kind]) {
				message = defaultMessages.common[kind];
			}
		}
		model['validationErrosList'].push({ field, message });
		return false;
	});
}

function skipValidation<M, N>(model: Entity<M, N>, config: ValidationOptions, kind: string) {
	let doValidate = true;
	let unless = () => {
		if (kind === 'unless') {
			doValidate = !doValidate;
		}
	};
	if (typeof config[kind] === 'function') {
		doValidate = config[kind].call(model);
		unless();
	} else if (typeof config[kind] === 'string') {
		if (typeof model[config[kind]] === 'function') {
			doValidate = model[config[kind]].call(model);
			unless();
		} else if (model['__data'].hasOwnProperty(config[kind])) {
			doValidate = model[config[kind]];
			unless();
		} else {
			doValidate = kind === 'if';
		}
	}
	return !doValidate;
}
