import { decodeAbiParameters, decodeEventLog, encodeEventTopics } from 'viem';
import IInteropCenterABI from '../../../../../core/internal/abis/IInteropCenter';
import type { Hex } from '../../../../../core/types/primitives';
import type { Log } from '../../../../../core/types/transactions';

export function createWithdrawalBundleCodec() {
  const interopBundleSentTopic = encodeEventTopics({
    abi: IInteropCenterABI,
    eventName: 'InteropBundleSent',
  })[0];

  return {
    interopBundleSentTopic,

    decodeBundleSent(log: { data: Hex; topics: Hex[] }) {
      const { args } = decodeEventLog({
        abi: IInteropCenterABI,
        eventName: 'InteropBundleSent',
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
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
    },

    decodeL1MessageData(log: Log): Hex {
      return decodeAbiParameters([{ type: 'bytes' }], log.data)[0];
    },
  };
}
