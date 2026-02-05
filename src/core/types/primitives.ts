// Primitive types
// TODO: might be useful between adapters (viem / ethers)
// problably can be removed
export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type Hash = Hex;

export const ZERO_HASH: Hash = '0x0000000000000000000000000000000000000000000000000000000000000000';
