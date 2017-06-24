import { ValidationOptions, ValidationType } from '../types';

export function Validate(validation: ValidationType, options?: ValidationOptions) {
	return (target: any, field: string) => {
		options = options || {};
		if (!target.$$validations) {
			target.$$validations = [];
		}
		if (validation === 'custom' && typeof target[field] === 'function') {
			options.customValidator = target[field];
		}
		options['validation'] = validation;
		target.$$validations.push({ field, options });
	};
}