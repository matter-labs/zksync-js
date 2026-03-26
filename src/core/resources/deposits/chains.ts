const ERAVM_CHAIN_IDS = new Set<bigint>([324n, 2741n, 11124n, 300n]);

export function isEraVmChain(chainIdL2: bigint): boolean {
  return ERAVM_CHAIN_IDS.has(chainIdL2);
}
