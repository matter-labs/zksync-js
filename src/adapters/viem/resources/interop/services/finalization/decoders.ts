import { decodeEventLog, decodeAbiParameters } from 'viem';
import type { Hex } from '../../../../../../core/types/primitives';
import type { Log } from '../../../../../../core/types/transactions';
import InteropCenterAbi from '../../../../../../core/internal/abis/IInteropCenter';

export function decodeInteropBundleSent(log: { data: Hex; topics: Hex[] }): {
  bundleHash: Hex;
  sourceChainId: bigint;
  destinationChainId: bigint;
} {
  const { args } = decodeEventLog({
    abi: InteropCenterAbi,
    eventName: 'InteropBundleSent',
    data: log.data,
    topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
  }) as unknown as {
    args: {
      interopBundleHash: Hex;
      interopBundle: {
        sourceChainId: bigint;
        destinationChainId: bigint;
      };
    };
  };

  return {
    bundleHash: args.interopBundleHash,
    sourceChainId: args.interopBundle.sourceChainId,
    destinationChainId: args.interopBundle.destinationChainId,
  };
}

export function decodeL1MessageData(log: Log): Hex {
  const [decoded] = decodeAbiParameters([{ type: 'bytes' }], log.data);
  return decoded;
}
