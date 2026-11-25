import { describe, it, expect } from 'bun:test';
import { Interface } from 'ethers';
import { toEventSelector, toFunctionSelector, type AbiEvent, type AbiFunction } from 'viem';

import { createEthersAtomicInteropHelpers } from '../../ethers/resources/interop/atomic.ts';
import { createViemAtomicInteropHelpers } from '../../viem/resources/interop/atomic.ts';
import { createEthersAttributesResource } from '../../ethers/resources/interop/attributes/resource.ts';
import { createViemAttributesResource } from '../../viem/resources/interop/attributes/resource.ts';
import {
  formatInteropEvmChain as formatChainEthers,
  formatInteropEvmChainAddress as formatChainAddressEthers,
} from '../../ethers/resources/interop/address.ts';
import {
  formatInteropEvmChain as formatChainViem,
  formatInteropEvmChainAddress as formatChainAddressViem,
} from '../../viem/resources/interop/address.ts';
import {
  IAtomicFlowManagerABI,
  IAtomicInteropErrorsABI,
  IERC7786AttributesABI,
  IInteropCenterABI,
  IL2InteropHandlerABI,
} from '../../../core/abi.ts';
import {
  ATOMIC_BUNDLE_ATTRIBUTE,
  BUNDLE,
  BUNDLE_DATA,
  BUNDLE_HASH,
  FLOW,
  SELECTORS,
  SENDER,
  TOPICS,
} from '../../../core/resources/interop/atomic/__tests__/vectors.ts';

const ADAPTERS = {
  ethers: {
    atomic: createEthersAtomicInteropHelpers(),
    attributes: createEthersAttributesResource(),
    formatChain: formatChainEthers,
    formatChainAddress: formatChainAddressEthers,
  },
  viem: {
    atomic: createViemAtomicInteropHelpers(),
    attributes: createViemAttributesResource(),
    formatChain: formatChainViem,
    formatChainAddress: formatChainAddressViem,
  },
} as const;

for (const [kind, adapter] of Object.entries(ADAPTERS)) {
  describe(`adapters/${kind}/atomic interop helpers`, () => {
    it('derives the flow id the chain accepted and each leg commit value', () => {
      const flow = adapter.atomic.buildFlow(FLOW);
      expect(flow.flowId).toBe(FLOW.flowId);
      FLOW.legs.forEach((leg, i) => {
        expect(adapter.atomic.computeCommitValue(flow.flowId, leg.bundleHash)).toBe(
          FLOW.commitValues[i],
        );
      });
    });

    it('encodes the atomicBundle attribute as the contracts decode it', () => {
      const { preimage } = adapter.atomic.buildFlow(FLOW);
      expect(adapter.attributes.bundle.atomicBundle(preimage, 42n)).toBe(ATOMIC_BUNDLE_ATTRIBUTE);
    });

    it('encodes, decodes and hashes an InteropBundle as Solidity does', () => {
      expect(adapter.atomic.encodeInteropBundle(BUNDLE)).toBe(BUNDLE_DATA);
      expect(adapter.atomic.decodeInteropBundle(BUNDLE_DATA)).toEqual(BUNDLE);
      expect(adapter.atomic.bundleHashOf(BUNDLE)).toBe(BUNDLE_HASH);
    });

    it('wraps bytes that are not a bundle into a validation error', () => {
      expect(() => adapter.atomic.decodeInteropBundle('0x1234')).toThrow(/not an ABI-encoded/);
    });

    it('formats ERC-7930 addresses with and without an account', () => {
      // An independent Rust implementation pins these bytes.
      expect(adapter.formatChain(7101n)).toBe('0x00010000021bbd00');
      expect(adapter.formatChainAddress(7101n, SENDER)).toBe(
        BUNDLE.bundleAttributes.unbundlerAddress,
      );
      // version 0x0001, chain type 0x0000, a 1-byte chain reference 0x01, a 20-byte address.
      expect(adapter.formatChainAddress(1n, SENDER)).toBe(`0x00010000010114${SENDER.slice(2)}`);
    });
  });
}

describe('atomic interop ABIs', () => {
  const functions = new Interface([
    ...IAtomicFlowManagerABI,
    ...IL2InteropHandlerABI,
    ...IInteropCenterABI.filter((f) => f.type === 'function' && f.name === 'previewBundleHash'),
    ...IInteropCenterABI.filter(
      (f) => f.type === 'function' && f.name === 'isInteropBundleSaltUsed',
    ),
    ...IERC7786AttributesABI.filter((f) => f.name === 'atomicBundle'),
  ]);

  it('nests the structs the way the Solidity signatures do', () => {
    for (const name of [
      'executeAtomicBundle',
      'verifyAtomicBundle',
      'requireFlowFinalized',
      'authorizeRefund',
      'claimRefund',
      'legState',
      'append',
      'previewBundleHash',
      'isInteropBundleSaltUsed',
      'bundleStatus',
      'atomicBundle',
    ] as const) {
      expect(functions.getFunction(name)!.selector).toBe(SELECTORS[name]);
      const item = [
        ...IAtomicFlowManagerABI,
        ...IL2InteropHandlerABI,
        ...IInteropCenterABI,
        ...IERC7786AttributesABI,
      ].find((f) => f.type === 'function' && f.name === name) as AbiFunction;
      expect(toFunctionSelector(item)).toBe(SELECTORS[name]);
    }
  });

  it('declares the errors and events the contracts emit', () => {
    const errors = new Interface([...IAtomicInteropErrorsABI, ...IInteropCenterABI]);
    for (const name of [
      'InteropPreviewHash',
      'ProofDeadlineExceeded',
      'ManagerLegNotRevertable',
      'ManagerFlowPreimageVersionMismatch',
    ] as const) {
      expect(errors.getError(name)!.selector).toBe(SELECTORS[name]);
    }
    for (const name of ['FlowCommitted', 'FlowRefunded'] as const) {
      const event = IAtomicFlowManagerABI.find(
        (f) => f.type === 'event' && f.name === name,
      ) as AbiEvent;
      expect(toEventSelector(event)).toBe(TOPICS[name]);
    }
  });
});
