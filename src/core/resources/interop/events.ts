// src/core/resources/interop/events.ts
import type { Hex } from '../../types/primitives';

export type InteropTopics = {
  interopBundleSent: Hex;
  bundleVerified: Hex;
  bundleExecuted: Hex;
  bundleUnbundled: Hex;
};
