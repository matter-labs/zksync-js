import { AbiCoder, keccak256 } from 'ethers';

import {
  createAtomicInteropPrimitives,
  type AtomicInteropCodec,
} from '../../../../core/resources/interop/atomic';
import type { Hex } from '../../../../core/types/primitives';

const abiCoder = AbiCoder.defaultAbiCoder();

export const ethersAtomicInteropCodec: AtomicInteropCodec = {
  hashFlow(input) {
    return keccak256(
      abiCoder.encode(
        ['bytes32[]', 'uint256[]', 'uint64', 'uint256'],
        [
          input.legBundleHashes,
          input.legSourceChainIds,
          input.deadline,
          input.settlementLayerChainId,
        ],
      ),
    ) as Hex;
  },
  hashCommit(input) {
    return keccak256(
      abiCoder.encode(
        ['bytes4', 'bytes32', 'bytes32'],
        [input.tag, input.flowId, input.bundleHash],
      ),
    ) as Hex;
  },
};

export const ethersAtomicInteropPrimitives =
  createAtomicInteropPrimitives(ethersAtomicInteropCodec);
