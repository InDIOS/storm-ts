import { Hooks, ArrayCallback } from './types';

export function isHook(name: string) {
	let hook = Hooks[Hooks[name]];
	return !!hook;
}

export function hasProp(obj: Object, prop: string) {
	return obj.hasOwnProperty(prop);
}

export function defineProp(obj: any, propertyName: string, propertyOptions: PropertyDescriptor) {
	Object.defineProperty(obj, propertyName, propertyOptions);
}

export function eachKey(object: Object, callback: ArrayCallback, thisArgs?: any) {
	keys(object).forEach(callback, thisArgs || object);
}

export function fixZero(value: number) {
	return value < 10 ? `0${value}` : value;
}

export function getIdType(adapterName: string) {
	switch (adapterName) {
		case 'mongodb':
			return 'objectId';
		case 'rethinkdb':
			return 'uuid';
		case 'sqlite':
			return 'int';
		default:
			return 'number';
	}
}

const uncountables = [
	'equipment', 'information', 'rice', 'money', 'species',
	'series', 'fish', 'sheep', 'moose', 'deer', 'news'
];
const pluralRules: Array<[RegExp, string]> = [
	[/(m)an$/gi, '$1en'],
	[/(pe)rson$/gi, '$1ople'],
	[/(child)$/gi, '$1ren'],
	[/^(ox)$/gi, '$1en'],
	[/(ax|test)is$/gi, '$1es'],
	[/(octop|vir)us$/gi, '$1i'],
	[/(alias|status)$/gi, '$1es'],
	[/(bu)s$/gi, '$1ses'],
	[/(buffal|tomat|potat)o$/gi, '$1oes'],
	[/([ti])um$/gi, '$1a'],
	[/sis$/gi, 'ses'],
	[/(?:([^f])fe|([lr])f)$/gi, '$1$2ves'],
	[/(hive)$/gi, '$1s'],
	[/([^aeiouy]|qu)y$/gi, '$1ies'],
	[/(x|ch|ss|sh)$/gi, '$1es'],
	[/(matr|vert|ind)ix|ex$/gi, '$1ices'],
	[/([m|l])ouse$/gi, '$1ice'],
	[/(quiz)$/gi, '$1zes'],
	[/s$/gi, 's'],
	[/$/gi, 's']
];

export function capitalize(str: string) {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

export function keys(obj: Object) {
	return Object.keys(obj);
}

export function safeRequire(moduleName: string) {
	try {
		return require(moduleName);
	} catch (e) {
		let args = moduleName;
		if (moduleName === 'rethinkdb') {
			args = `${moduleName} generic-pool moment async`;
		}
		console.log(`Run 'npm install ${args}' command to using ${moduleName} database engine`);
		process.exit(1);
	}
}

// http://code.google.com/p/inflection-js/
export function pluralize(str: string, override) {
	if (override) {
		str = override;
	} else {
		let ignore = !!~uncountables.indexOf(str.toLowerCase());
		if (!ignore) {
			for (let i = 0; i < pluralRules.length; i++) {
				let match = pluralRules[i][0];
				let replace = pluralRules[i][1];
				if (str.match(match)) {
					str = str.replace(match, replace);
					break;
				}
			}
		}
	}
	return str;
}

export function selectFields(fieldsString: string, primaryKey: string, props: string[]) {
	let fields: { [key: string]: number } = {};
	let includes: { [key: string]: number } = {};
	let excludes: { [key: string]: number } = {};
	let inc = 0, exc = 0;
	fieldsString.split(' ').forEach(field => {
		let cleanField = field.replace('-', '');
		if (field.startsWith('-') && cleanField !== primaryKey) {
			excludes[cleanField] = 0;
			exc++;
		} else {
			includes[cleanField] = 1;
			inc++;
		}
	});
	includes[primaryKey] = 1;
	if (inc > exc) {
		fields = includes;
	} else {
		fields = excludes;
	}
	let fieldNames: string[] = [];
	if (keys(fields).every(val => fields[val] === 1)) {
		fieldNames = keys(fields);
	} else {
		fieldNames = props.filter(val => fields[val] !== 0);
	}
	return fieldNames;
}

export function applyFilter<M>(filter: { where?: Object }) {
	if (typeof filter.where === 'function') {
		return filter.where;
	} else {
		return (obj: M) => {
			let pass = true;
			eachKey(filter.where, key => {
				if (typeof filter.where[key] === 'object' && !filter.where[key].getTime) {
					pass = parseCond(obj[key], filter.where[key]);
				} else {
					if (!testString(filter.where[key], obj[key])) {
						pass = false;
					}
				}
			});
			return pass;
		};
	}
}

export function getInstanceId(id) {
	if (typeof id === 'object' && id.constructor === Array) {
		id = id[0];
	}
	return id;
}

export function testString(str, value) {
	if (typeof value === 'string' && str && str.constructor.name === 'RegExp') {
		return value.match(str);
	}
	return (str !== null ? str.toString() : str) === (value !== null ? value.toString() : value);
}

export function parseCond(val, conds) {
	let outs = false;
	eachKey(conds, condType => {
		switch (condType) {
			case 'gt':
				outs = val > conds[condType] ? true : false;
				break;
			case 'gte':
				outs = val >= conds[condType] ? true : false;
				break;
			case 'lt':
				outs = val < conds[condType] ? true : false;
				break;
			case 'lte':
				outs = val <= conds[condType] ? true : false;
				break;
			case 'between':
				let bt = conds[condType];
				outs = (val >= bt[0] && val <= bt[1]) ? true : false;
				break;
			case 'inq':
			case 'in':
				outs = conds[condType].some(cval => val === cval);
				break;
			case 'nin':
				outs = conds[condType].every(cval => val !== cval);
				break;
			case 'neq':
			case 'ne':
				outs = val !== conds[condType] ? true : false;
				break;
			case 'regex':
			case 'like':
				outs = new RegExp(conds[condType]).test(val);
				break;
			case 'nlike':
				outs = !new RegExp(conds[condType]).test(val);
				break;
			default:
				outs = val === conds[condType] ? true : false;
				break;
		}
	});
	return outs;
}
