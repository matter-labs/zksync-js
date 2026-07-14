import { encodeAbiParameters, keccak256 } from 'viem';

import {
  createAtomicInteropPrimitives,
  type AtomicInteropCodec,
} from '../../../../core/resources/interop/atomic';

export const viemAtomicInteropCodec: AtomicInteropCodec = {
  hashFlow(input) {
    return keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32[]' }, { type: 'uint256[]' }, { type: 'uint64' }, { type: 'uint256' }],
        [
          [...input.legBundleHashes],
          [...input.legSourceChainIds],
          input.deadline,
          input.settlementLayerChainId,
        ],
      ),
    );
  },
  hashCommit(input) {
    return keccak256(
      encodeAbiParameters(
        [{ type: 'bytes4' }, { type: 'bytes32' }, { type: 'bytes32' }],
        [input.tag, input.flowId, input.bundleHash],
      ),
    );
  },
};

export const viemAtomicInteropPrimitives = createAtomicInteropPrimitives(viemAtomicInteropCodec);
