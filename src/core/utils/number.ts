export const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export const isBigint = (x: unknown): x is bigint => typeof x === 'bigint';
