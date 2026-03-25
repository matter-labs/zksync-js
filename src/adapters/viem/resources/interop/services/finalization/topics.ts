import { encodeEventTopics } from 'viem';
import type { InteropTopics } from '../../../../../../core/resources/interop/events';
import InteropCenterAbi from '../../../../../../core/internal/abis/IInteropCenter';
import IInteropHandlerAbi from '../../../../../../core/internal/abis/IInteropHandler';

// Event topics computed via viem encodeEventTopics
export function getTopics(): { topics: InteropTopics } {
  const topics: InteropTopics = {
    interopBundleSent: encodeEventTopics({
      abi: InteropCenterAbi,
      eventName: 'InteropBundleSent',
    })[0],
    bundleVerified: encodeEventTopics({
      abi: IInteropHandlerAbi,
      eventName: 'BundleVerified',
    })[0],
    bundleExecuted: encodeEventTopics({
      abi: IInteropHandlerAbi,
      eventName: 'BundleExecuted',
    })[0],
    bundleUnbundled: encodeEventTopics({
      abi: IInteropHandlerAbi,
      eventName: 'BundleUnbundled',
    })[0],
  };

  return { topics };
}
