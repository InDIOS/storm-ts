import { FieldOptions } from '../types';

export function Column(type: string, options?: FieldOptions) {
	return (targe: any, field: string) => {
		if (!targe.$$fields) {
			targe.$$fields = {};
		}
		if (typeof options === 'undefined') {
			options = { type: '' };
		}
		options.type = type;
		targe.$$fields[field] = options;
		// delete targe[field];
	};
}