export function OneToMany(modelName: string, foreignKey: string) {
	return relation('$$oneToMany', modelName, foreignKey);
}

export function OneToOne(modelName: string, foreignKey: string) {
	return relation('$$oneToOne', modelName, foreignKey);
}

function relation(rel: string, modelName: string, foreignKey: string) {
	return (target: any, key: string) => {
		if (!target[rel]) {
			target[rel] = {};
		}
		target[rel][modelName] = { prop: key, fkey: foreignKey };
	};
}