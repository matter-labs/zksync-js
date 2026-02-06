import { AbiCoder, type Interface } from 'ethers';
import type { Hex } from '../../../../../../core/types/primitives';
import type { Log } from '../../../../../../core/types/transactions';

export function decodeInteropBundleSent(
  centerIface: Interface,
  log: { data: Hex; topics: Hex[] },
): {
  bundleHash: Hex;
  sourceChainId: bigint;
  destinationChainId: bigint;
} {
  const decoded = centerIface.decodeEventLog(
    'InteropBundleSent',
    log.data,
    log.topics,
  ) as unknown as {
    interopBundleHash: Hex;
    interopBundle: {
      sourceChainId: bigint;
      destinationChainId: bigint;
    };
  };

  return {
    bundleHash: decoded.interopBundleHash,
    sourceChainId: decoded.interopBundle.sourceChainId,
    destinationChainId: decoded.interopBundle.destinationChainId,
  };
}

export function decodeL1MessageData(log: Log): Hex {
  const decoded = AbiCoder.defaultAbiCoder().decode(['bytes'], log.data);
  return decoded[0] as Hex;
}
