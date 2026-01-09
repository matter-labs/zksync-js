// src/adapters/ethers/resources/interop/attributes/__examples__/power-user.ts
import type { Address } from '../../../../../../core/types/primitives';
import { createEthersAttributesResource } from '../resource';

const attrs = createEthersAttributesResource();

const executor = '0x0000000000000000000000000000000000000001' as Address;
const unbundler = '0x0000000000000000000000000000000000000002' as Address;

const messageValue = 1n;
const bridgedAmount = 1n;

const bundleAttrs = [
  attrs.bundle.executionAddress(executor),
  attrs.bundle.unbundlerAddress(unbundler),
] as const;

const callAttrs = attrs.call.nativeBridge(messageValue, bridgedAmount);

const summary = attrs.decode.summarize(callAttrs, bundleAttrs);

void summary;
