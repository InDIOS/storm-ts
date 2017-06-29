import { Entity } from './model';
import { Connection } from './connection';

/*export type RawType = string | number | boolean | Raw;

export interface Raw {
	[key: string]: RawType | RawType[];
}
*/
export type RelationOneToMany<M, N> = {
	(data: M): N;
	(): Promise<N[]>;
	create(data: M): Promise<N>;
	find(conditions: ConditionOptions): Promise<N[]>;
	remove(conditions: ConditionOptions): Promise<boolean>;
	update(conditions: ConditionOptions, data: M): Promise<N[]>;
};

export type RelationOneToOne<M, N> = {
	(data?: M): Promise<N>;
};

export type ArrayCallback = {
	(value?: string, index?: number, array?: string[]): any;
};

export type Definition = {
	[model: string]: {
		pKeys: PrimaryKey[];
		properties: { [field: string]: FieldOptions };
	}
};

export type Validator = {
	<T, Z>(model: Entity<T, Z>, field: string, config?: ValidationOptions): Promise<boolean | string>;
};

export type IndexOption = string | boolean | {
	name?: string;
	unique?: boolean;
};

export interface AdapterDefinition {
	model: typeof Entity;
	pKeys: PrimaryKey[];
	properties: { [field: string]: FieldOptions };
}

export interface PrimaryKey {
	pKey: string;
	generated?: boolean;
}

export interface ConnectionOptions {
	url?: string;
	host?: string;
	port?: number;
	ssl?: boolean;
	pool?: boolean;
	driver: string;
	database: string;
	username?: string;
	password?: string;
	[key: string]: string | number | boolean;
}

export interface ConditionOptions extends Object {
	skip?: number;
	limit?: number;
	where?: Object;
	fields?: string;
	order?: { [key: string]: 1 | -1; };
}

export interface FieldOptions {
	type?: string;
	default?: any;
	precision?: number;
	decimals?: number;
	unique?: boolean;
	nullable?: boolean;
	index?: boolean | string;
}

export interface Validation {
	field: string;
	options: ValidationOptions;
}

export type ValidationType = 'presence' | 'length' | 'numericality' | 'inclusion' |
	'exclusion' | 'format' | 'custom' | 'uniqueness';

export interface ValidationOptions {
	in?: any[];
	is?: number;
	min?: number;
	max?: number;
	int?: boolean;
	with?: string | RegExp;
	message?: string;
	allowNull?: boolean;
	allowBlank?: boolean;
	if?: string | Function;
	unless?: string | Function;
	customValidator?: Function;
}

export interface ValidationError {
	field: string;
	message: string;
}

export interface ModelOptions {
	connection?: Connection;
	validations?: Validation[];
	primaryKeys?: PrimaryKey[];
	hooks?: { [key: string]: Function };
	methods?: { [key: string]: Function };
	fields?: { [key: string]: FieldOptions };
	indexes?: { [key: string]: { columns: string } };
	relOneToOne?: { [key: string]: { prop: string, fkey: string } };
	relOneToMany?: { [key: string]: { prop: string, fkey: string } };
}

export abstract class Adapter {
	readonly name: string;
	static initialize(connection: Connection, done: (adapter: Adapter) => void): void {
		throw new Error('Method not implemented.');
	}
	abstract define(definition: AdapterDefinition): void;
	abstract defineProperty(modelName: string, field: string, params: FieldOptions): void;
	abstract exists(modelName: string, id: number | string | Object): Promise<boolean>;
	abstract count(modelName: string, query: ConditionOptions): Promise<number>;
	abstract create<M>(modelName: string, data: M): Promise<M>;
	abstract save<M>(modelName: string, data: M): Promise<M>;
	abstract find<M>(modelName: string, query: ConditionOptions): Promise<M[]>;
	abstract update<M>(modelName: string, query: ConditionOptions, data: M): Promise<M[]>;
	abstract updateOrCreate<M>(modelName: string, query: ConditionOptions, data: M): Promise<M[]>;
	abstract remove(modelName: string, query: ConditionOptions): Promise<boolean>;
	abstract removeById(modelName: string, id: number | string | Object): Promise<boolean>;
	abstract removeAll(modelName: string): Promise<void>;
	protected abstract toDatabase<M>(data: M, pKey: string): M;
	protected abstract fromDatabase<M>(modelName: string, data: M): M | Object;
	abstract ensureIndex(modelName: string, fields: string | string[], params?: string | boolean | IndexOption): Promise<void>;
	disconnect?(): void;
	freezeSchema?(): void;
	connect?(...params): Promise<any>;
}

/*interface SQLAdapter extends Adapter {
	query<M>(statement: string): Promise<M>;
	isActual?(): Promise<any>;
	autoupdate?(): Promise<any>;
	automigrate?(): Promise<any>;
	createIndexes?(modelName: string, fields: Object): Promise<any>;
}*/

export enum Hooks {
	afterInitialize,
	beforeSave, afterSave,
	beforeCreate, afterCreate,
	beforeUpdate, afterUpdate,
	beforeDestroy, afterDestroy,
	beforeValidate, afterValidate
}
