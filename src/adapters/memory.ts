import { Connection } from '../connection';
import { applyFilter, keys, selectFields } from '../utils';
import {
  Adapter, AdapterDefinition,
  ConditionOptions, FieldOptions, IndexOption
} from '../types';


class Memory extends Adapter {

  readonly name: string;
  private ids: { [key: string]: number };
  private _models: { [key: string]: AdapterDefinition };
  private cache: { [key: string]: { [key: string]: Object } };

  constructor() {
    super();
    this.name = 'memory';
    this._models = {};
    this.cache = {};
    this.ids = {};
  }

  define(definition: AdapterDefinition) {
    let { modelName } = definition.model;
    this._models[modelName] = definition;
    this.cache[modelName] = {};
    this.ids[modelName] = 1;
  }

  defineProperty(modelName: string, field: string, params: FieldOptions): void {
    this._models[modelName].properties[field] = params;
  }

  exists(modelName: string, id: number | string | Object): Promise<boolean> {
    return Promise.resolve(this.cache[modelName].hasOwnProperty(id.toString()));
  }

  ensureIndex(modelName: string, fields: string | string[], params?: string | boolean | IndexOption): Promise<void> {
    throw new Error('Method not implemented.');
  }

  count(modelName: string, query: ConditionOptions): Promise<number> {
    let cache = this.cache[modelName];
    let data = keys(cache);
    let where = query.where;
    if (where && typeof where === 'object') {
      let conds = keys(where);
      data = data.filter(id => {
        return !conds.some(key => {
          return cache[id][key] !== where[key];
        });
      });
      return Promise.resolve(data.length);
    } else {
      return Promise.resolve(0);
    }
  }

  create<M, N>(modelName: string, data: M): Promise<N> {
    let [{ pKey }] = this._models[modelName].pKeys;
    let id: number = data[pKey] || this.ids[modelName]++;
    data[pKey] = id;
    this.cache[modelName][id] = data;
    return Promise.resolve(this.cache[modelName][id]);
  }

  save<M, N>(modelName: string, data: M): Promise<N> {
		let [{ pKey }] = this._models[modelName].pKeys;
    this.cache[modelName][data[pKey]] = data;
    return Promise.resolve(this.cache[modelName][data[pKey]]);
  }

  find<N>(modelName: string, query: ConditionOptions) {
    let modelCache = this.cache[modelName];
		let [{ pKey }] = this._models[modelName].pKeys;
    let records = keys(modelCache).map(model => <N>modelCache[model]);

    if (query.fields) {
      let fieldNames = selectFields(query.fields, pKey, keys(this._models[modelName].properties));
      records = records.map(record => {
        let newNode = <N>{};
        for (let key in record) {
          if (record.hasOwnProperty(key)) {
            if (!fieldNames.length || ~fieldNames.indexOf(key)) {
              newNode[key] = record[key];
            }
          }
        }
        return newNode;
      });
    }

    if (query.where) {
      records = records ? records.filter(applyFilter<N>(query)) : records;
    }

    if (query.order) {
      let props = keys(query.order);
      records = records.sort((a, b) => {
        for (let i = 0, l = props.length; i < l; i++) {
          let key = props[i];
          let order = query.order[key];
          if (a[key] > b[key]) {
            return 1 * order;
          } else if (a[key] < b[key]) {
            return -1 * order;
          }
        }
        return 0;
      });
    }

    if (query.limit || query.skip) {
      let skip = query.skip || 0;
      let limit = query.limit || 0;
      if ((skip + limit) < records.length) {
        records = records.slice(skip, skip + limit);
      } else {
        records = [];
      }
    }

    return Promise.resolve(records);
  }

  remove(modelName: string, query: ConditionOptions): Promise<boolean> {
		let [{ pKey }] = this._models[modelName].pKeys;
    return this.find(modelName, query).then((records) => {
      let count = records.length;
      if (count) {
        records.forEach(record => {
          delete this.cache[modelName][record[pKey]];
          if (--count) {
            return Promise.resolve(true);
          }
        });
      } else {
        return Promise.resolve(false);
      }
    });
  }

  update<M, N>(modelName: string, query: ConditionOptions, data: M): Promise<N[]> {
		let [{ pKey }] = this._models[modelName].pKeys;
    return this.find<N>(modelName, query).then(records => {
      return records.map(record => {
        this.cache[modelName][record[pKey]] = Object.assign(record, data);
        return record;
      });
    });
  }

  updateOrCreate<M, N>(modelName: string, query: ConditionOptions, data: M): Promise<N[]> {
    return this.update(modelName, query, data).then(records => {
      if (records.length) {
        return records;
      } else {
        return this.create(modelName, data).then(record => [record]);
      }
    });
  }

  removeById(modelName: string, id: number | string | Object): Promise<boolean> {
    let models = keys(this.cache[modelName]);
    let deleted = false;
    for (let i = 0, l = models.length; i < l; i++) {
      let _id = l[i];
      if (_id === id.toString()) {
        deleted = delete this.cache[modelName][_id];
        i = l;
      }
    }
    return Promise.resolve(deleted);
  }

  removeAll(modelName: string): Promise<void> {
    this.cache[modelName] = {};
    return Promise.resolve();
  }

  protected toDatabase() { }
  protected fromDatabase() { }

  static initialize(connection: Connection, done: Function) {
    done(new Memory());
  }
}

export = Memory;