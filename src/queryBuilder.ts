import { Entity } from './model';
import { ConditionOptions } from './types';

export interface Query {
	params: Object;
	conditions: Object;
	pkey: boolean | string;
};

export class QueryBuilder<M> {

	query: Query;
	action: string;
	model: typeof Entity;

	constructor(model: typeof Entity, action?: string, conditions?: Object) {
		this.model = model;
		this.action = action || 'find';
		conditions = typeof conditions === 'object' ? conditions : {};
		let where = conditions['where'] || {};
		delete conditions['where'];
		this.query = {
			conditions: where,
			params: conditions,
			pkey: false
		};
	}

	asc(value: string) {
		this.query.pkey = false;
		this.query.params['order'] = value + ' ASC';
		return this;
	}

	desc(value: string) {
		this.query.pkey = false;
		this.query.params['order'] = value + ' DESC';
		return this;
	}

	where(key: any, value?: any) {
		if (typeof value === 'undefined') {
			this.query.pkey = key;
		} else {
			this.query.pkey = false;
			this.query.conditions[key] = value;
		}
		return this;
	}

	or(values: any[]) {
		if (Array.isArray(values)) {
			this.query.conditions['or'] = values;
		}
		return this;
	}

	range(key: string, from: any, to?: any) {
		if (typeof to === 'undefined') {
			if (this.query.pkey && typeof this.query.pkey === 'string') {
				to = from;
				from = key;
				if (typeof this.query.conditions[this.query.pkey] === 'undefined') {
					this.query.conditions[this.query.pkey] = {};
				}
				this.query.conditions[this.query.pkey].gt = from;
				this.query.conditions[this.query.pkey].lt = to;
			}
		} else {
			this.query.pkey = false;
			if (typeof this.query.conditions[key] === 'undefined') {
				this.query.conditions[key] = {};
			}
			this.query.conditions[key].gt = from;
			this.query.conditions[key].lt = to;
		}
		return this;
	}

	fields(keys: string) {
		if (typeof keys === 'string') {
			this.query.params['fields'] = keys;
		}
		return this;
	}

	slice(skip: number, limit?: number) {
		if (typeof limit === 'undefined') {
			this.limit(skip);
		} else {
			this.skip(skip);
			this.limit(limit);
		}
		return this;
	}

	limit(limit: number) {
		genMethodsType1(this, 'limit', limit);
		return this;
	}

	skip(skip: number) {
		genMethodsType1(this, 'skip', skip);
		return this;
	}

	order(key: string, value?: string | 1 | -1) {
		let order: { [key: string]: 1 | -1 } = {};
		if (!value) {
			let mached = key.match(/\s+(A|DE)SC$/i);
			if (mached) {
				key = key.replace(/\s+(A|DE)SC/i, '');
				order[key] = mached[1] === 'DE' ? -1 : 1;
			} else {
				order[key] = -1;
			}
		} else {
			order[key] = value === 'DESC' || value === -1 ? -1 : 1;
		}
		this.query.pkey = false;
		if (!this.query.params['order']) {
			this.query.params['order'] = {};
		}
		this.query.params['order'] = { ...this.query.params['order'], ...order };
		return this;
	}

	group(key: string) {
		genMethodsType1(this, 'group', key);
		return this;
	}

	gt(key: any, value?: any) {
		genMethodsType2(this, 'gt', key, value);
		return this;
	}

	lt(key: any, value?: any) {
		genMethodsType2(this, 'lt', key, value);
		return this;
	}

	gte(key: any, value?: any) {
		genMethodsType2(this, 'gte', key, value);
		return this;
	}

	lte(key: any, value?: any) {
		genMethodsType2(this, 'lte', key, value);
		return this;
	}

	in(key: any, value?: any) {
		genMethodsType2(this, 'in', key, value);
		return this;
	}

	ne(key: any, value?: any) {
		genMethodsType2(this, 'ne', key, value);
		return this;
	}

	inq(key: any, value?: any) {
		genMethodsType2(this, 'inq', key, value);
		return this;
	}

	neq(key: any, value?: any) {
		genMethodsType2(this, 'neq', key, value);
		return this;
	}

	nin(key: any, value?: any) {
		genMethodsType2(this, 'nin', key, value);
		return this;
	}

	regex(key: any, value?: any) {
		genMethodsType2(this, 'regex', key, value);
		return this;
	}

	like(key: any, value?: any) {
		genMethodsType2(this, 'like', key, value);
		return this;
	}

	nlike(key: any, value?: any) {
		genMethodsType2(this, 'nlike', key, value);
		return this;
	}

	between(key: any, value?: any) {
		genMethodsType2(this, 'between', key, value);
		return this;
	}

	exec(...args: any[]): Promise<M> {
		return this.model[this.action](QueryBuilder.build({}, this), ...args);
	}

	static build<M>(conditions: ConditionOptions, queryInst: QueryBuilder<M>) {
		if (typeof conditions.where === 'undefined') {
			conditions.where = {};
		}
		conditions.where = Object.assign(conditions.where, queryInst.query.conditions);
		queryInst.query.conditions = {};

		for (let key in queryInst.query.params) {
			if (typeof conditions[key] === 'undefined') {
				conditions[key] = {};
			}
			conditions[key] = queryInst.query.params[key];
		}

		queryInst.query.params = {};
		queryInst.query.pkey = false;
		return conditions;
	}
}

function genMethodsType1<M>(queryInst: QueryBuilder<M>, method: string, value: any) {
	queryInst.query.pkey = false;
	queryInst.query.params[method] = value;
}

function genMethodsType2<M>(queryInst: QueryBuilder<M>, method: string, key: string, value?: any) {
	if (typeof value === 'undefined') {
		if (queryInst.query.pkey && typeof queryInst.query.pkey === 'string') {
			if (typeof queryInst.query.conditions[queryInst.query.pkey] === 'undefined') {
				queryInst.query.conditions[queryInst.query.pkey] = {};
			}
			queryInst.query.conditions[queryInst.query.pkey][method] = key;
		}
	} else {
		queryInst.query.pkey = false;
		if (typeof queryInst.query.conditions[key] === 'undefined') {
			queryInst.query.conditions[key] = {};
		}
		queryInst.query.conditions[key][method] = value;
	}
	return queryInst;
}