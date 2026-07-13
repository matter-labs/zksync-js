import { AbiCoder, Interface } from 'ethers';
import IInteropCenterABI from '../../../../../core/internal/abis/IInteropCenter';
import type { Hex } from '../../../../../core/types/primitives';
import type { Log } from '../../../../../core/types/transactions';

export function createWithdrawalBundleCodec() {
  const centerInterface = new Interface(IInteropCenterABI);
  const interopBundleSentTopic = centerInterface.getEvent('InteropBundleSent')!.topicHash as Hex;

  return {
    interopBundleSentTopic,

    decodeBundleSent(log: { data: Hex; topics: Hex[] }) {
      const decoded = centerInterface.decodeEventLog(
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
    },

    decodeL1MessageData(log: Log): Hex {
      return AbiCoder.defaultAbiCoder().decode(['bytes'], log.data)[0] as Hex;
    },
  };
}
