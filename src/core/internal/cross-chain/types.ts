import type { Address, Hex } from '../../types/primitives';

/** Internal proof material used to complete a non-atomic withdrawal bundle on L1. */
export interface BundleMessageProof {
  chainId: bigint;
  l1BatchNumber: bigint;
  l2MessageIndex: bigint;
  message: {
    txNumberInBatch: number;
    sender: Address;
    data: Hex;
  };
  proof: Hex[];
}

/** Internal withdrawal completion payload. This is not part of the interop API. */
export interface BundleFinalizationInfo {
  l2SrcTxHash: Hex;
  bundleHash: Hex;
  dstChainId: bigint;
  proof: BundleMessageProof;
  encodedData: Hex;
}
