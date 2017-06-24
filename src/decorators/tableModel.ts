import { Entity } from '../model';
import { isHook, keys } from '../utils';
import { ModelOptions } from '../types';
import { Connection } from '../connection';

export function Table(connection: Connection) {
	if (!connection) {
		console.log('Connection Options are required.');
		return;
	}
	return (model: typeof Entity): any => {
		let options: ModelOptions = {};
		model.modelName = model.name;
		model.connection = connection;
		
		let instance = model.prototype;

		options.hooks = {};
		options.methods = {};
		options.fields = instance['$$fields'] || {};
		options.primaryKeys = instance['$$primaryKeys'] || [];
		options.validations = instance['$$validations'] || [];

		options.relOneToOne = instance['$$oneToOne'] || {};
		options.relOneToMany = instance['$$oneToMany'] || {};

		delete instance['$$fields'];
		delete instance['$$oneToOne'];
		delete instance['$$oneToMany'];
		delete instance['$$primaryKeys'];
		delete instance['$$validations'];

		let keys = Object.getOwnPropertyNames(instance);

		for (let i in keys) {
			let key = keys[i];
			if (key === 'constructor') {
				continue;
			}
			let ishook = isHook(key);
			options[ishook ? 'hooks' : 'methods'][key] = instance[key];
			if (ishook) {
				delete model.prototype[key];
				model.prototype[key] = () => console.log('[Warning] Hooks are functions not callable.');
			}
		}

		return connection.defineModel(model, cleanOptions(options));
	};
}

function cleanOptions(options: ModelOptions) {
	if (!keys(options.methods).length) {
		delete options.methods;
	}
	if (!keys(options.relOneToMany).length) {
		delete options.relOneToMany;
	}
	if (!keys(options.relOneToOne).length) {
		delete options.relOneToOne;
	}
	return options;
}