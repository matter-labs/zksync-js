import { Interface } from 'ethers';
import type { InteropTopics } from '../../../../../../core/resources/interop/events';
import InteropCenterAbi from '../../../../../../core/internal/abis/InteropCenter';
import IInteropHandlerAbi from '../../../../../../core/internal/abis/IInteropHandler';
import type { Hex } from '../../../../../../core';

// Event topics and decoding
export function getTopics(): { topics: InteropTopics; centerIface: Interface } {
  const centerIface = new Interface(InteropCenterAbi);
  const handlerIface = new Interface(IInteropHandlerAbi);

  const topics = {
    interopBundleSent: centerIface.getEvent('InteropBundleSent')!.topicHash as Hex,
    bundleVerified: handlerIface.getEvent('BundleVerified')!.topicHash as Hex,
    bundleExecuted: handlerIface.getEvent('BundleExecuted')!.topicHash as Hex,
    bundleUnbundled: handlerIface.getEvent('BundleUnbundled')!.topicHash as Hex,
  };

  return { topics, centerIface };
}
