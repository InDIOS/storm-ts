import { Entity } from './model';
import { hasProp, keys } from './utils';
import { ValidationOptions } from './types';

/**
 * Validate Presence.
 * @param {Object} model 
 * @param {string} field 
 * @param {Object} config 
 */
export function presence<M, N>(model: Entity<M, N>, field: string, config?: ValidationOptions) {
	return Promise.resolve(isBlank(model[field]) ? 'null' : true);
}

/**
 * Validate Length.
 * @param {Object} model 
 * @param {string} field 
 * @param {Object} config 
 */
export function length<M, N>(model: Entity<M, N>, field: string, config?: ValidationOptions) {
	let isNull = isNullCheck<M, N>(model, field, config);
	if (isNull === true || typeof isNull === 'string') {
		return Promise.resolve(isNull);
	}
	let length: number = model[field].length;
	if (hasProp(config, 'min') && length < config.min) {
		return Promise.resolve('min');
	}
	if (hasProp(config, 'max') && length > config.max) {
		return Promise.resolve('max');
	}
	if (hasProp(config, 'is') && length !== config.is) {
		return Promise.resolve('is');
	}
	return Promise.resolve(true);
}

/**
 * Validate Numericality.
 * @param {Object} model 
 * @param {string} field 
 * @param {Object} config 
 */
export function numericality<M, N>(model: Entity<M, N>, field: string, config?: ValidationOptions) {
	let isNull = isNullCheck<M, N>(model, field, config);
	if (isNull === true || typeof isNull === 'string') {
		return Promise.resolve(isNull);
	}
	if (typeof model[field] !== 'number') {
		return Promise.resolve('number');
	}
	if (hasProp(config, 'int') && model[field] !== Math.round(model[field])) {
		return Promise.resolve('int');
	}
	return Promise.resolve(true);
}

/**
 * Validate Inclusion.
 * @param {Object} model 
 * @param {string} field 
 * @param {Object} config 
 */
export function inclusion<M, N>(model: Entity<M, N>, field: string, config?: ValidationOptions) {
	let isNull = isNullCheck<M, N>(model, field, config);
	if (isNull === true || typeof isNull === 'string') {
		return Promise.resolve(isNull);
	}
	if (hasProp(config, 'in') && !~config.in.indexOf(model[field])) {
		return Promise.resolve(false);
	}
	return Promise.resolve(true);
}

/**
 * Validate Exclusion.
 * @param {Object} model 
 * @param {string} field 
 * @param {Object} config 
 */
export function exclusion<M, N>(model: Entity<M, N>, field: string, config?: ValidationOptions) {
	let isNull = isNullCheck<M, N>(model, field, config);
	if (isNull === true || typeof isNull === 'string') {
		return Promise.resolve(isNull);
	}
	if (hasProp(config, 'in') && ~config.in.indexOf(model[field])) {
		return Promise.resolve(false);
	}
	return Promise.resolve(true);
}

/**
 * Validate Format.
 * @param {Object} model 
 * @param {string} field 
 * @param {Object} config 
 */
export function format<M, N>(model: Entity<M, N>, field: string, config?: ValidationOptions) {
	let isNull = isNullCheck<M, N>(model, field, config);
	if (isNull === true || typeof isNull === 'string') {
		return Promise.resolve(isNull);
	}
	if (typeof model[field] === 'string') {
		if (!model[field].match(config.with)) {
			return Promise.resolve(false);
		} else {
			return Promise.resolve(true);
		}
	} else {
		return Promise.resolve(true);
	}
}

/**
 * Validate Custom.
 * @param {Object} model 
 * @param {string} field 
 * @param {Object} config 
 */
export function custom<M, N>(model: Entity<M, N>, field: string, config?: ValidationOptions) {
	return new Promise<boolean>((resolve, reject) => {
		config.customValidator.call(model, resolve, reject);
	});
}

/**
 * Validate Uniqueness.
 * @param {Object} model 
 * @param {string} field 
 * @param {Object} config 
 */
export function uniqueness<M, N>(model: Entity<M, N>, field: string, config?: ValidationOptions) {
	let cond = { where: {} };
	cond.where[field] = model[field];
	let promise = model.rootModel.find<M, N>(cond);
	let [{ field: pkey }] = model.rootModel.connection.definitions[model.modelName].pKeys;
	return promise.then(onSuccess);

	function onSuccess(found: N[]) {
		if (found.length > 1) {
			return false;
		} else if (found.length === 1 && (!model[pkey] || !found[0][pkey] || found[0][pkey].toString() !== model[pkey].toString())) {
			return false;
		}
		return true;
	}
}

function isNullCheck<M, N>(model: Entity<M, N>, field: string, config?: ValidationOptions) {
	let isNull = model[field] === null || typeof model[field] === 'undefined';
	if (isNull) {
		if (!config.allowNull) {
			return 'null';
		}
		return true;
	} else {
		if (isBlank(model[field])) {
			if (!config.allowBlank) {
				return 'blank';
			}
			return true;
		}
		return false;
	}
}

function isBlank(value) {
	if (typeof value === 'undefined') {
		return true;
	} else if (Array.isArray(value) && value.length === 0) {
		return true;
	} else if (value === null) {
		return true;
	} else if (typeof value === 'string' && value === '') {
		return true;
	} else if (typeof value === 'object' && keys(value).length === 0) {
		return true;
	}
	return false;
}
