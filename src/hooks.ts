import { capitalize } from './utils';

export function beforeHook(method: string, thisArg: any) {
	method = `before${capitalize(method)}`;
	if (typeof thisArg['_hooks'][method] === 'function') {
		thisArg['_hooks'][method].call(thisArg);
	}
}

export function afterHook(method: string, thisArg: any, value?: any) {
	method = `after${capitalize(method)}`;
	if (typeof thisArg['_hooks'][method] === 'function') {
		thisArg['_hooks'][method].call(thisArg, value);
	}
}
