import { describe, expect, it } from 'bun:test';

import { createDepositsResource as createEthersDepositsResource } from '../../ethers/resources/deposits';
import {
  createFinalizationServices as createEthersFinalizationServices,
  createWithdrawalsResource as createEthersWithdrawalsResource,
} from '../../ethers/resources/withdrawals';
import {
  createInteropFinalizationServices as createEthersInteropFinalizationServices,
  createInteropResource as createEthersInteropResource,
} from '../../ethers/resources/interop';
import { createDepositsResource as createViemDepositsResource } from '../../viem/resources/deposits';
import {
  createFinalizationServices as createViemFinalizationServices,
  createWithdrawalsResource as createViemWithdrawalsResource,
} from '../../viem/resources/withdrawals';
import {
  createInteropFinalizationServices as createViemInteropFinalizationServices,
  createInteropResource as createViemInteropResource,
} from '../../viem/resources/interop';
import { createAdapterHarness } from '../adapter-harness';

const DEPOSIT_METHODS = [
  'create',
  'prepare',
  'quote',
  'status',
  'tryCreate',
  'tryPrepare',
  'tryQuote',
  'tryWait',
  'wait',
];

const WITHDRAWAL_METHODS = [
  'create',
  'finalize',
  'prepare',
  'quote',
  'status',
  'tryCreate',
  'tryFinalize',
  'tryPrepare',
  'tryQuote',
  'tryWait',
  'wait',
];

const INTEROP_METHODS = [
  'create',
  'finalize',
  'getInteropRoot',
  'prepare',
  'quote',
  'status',
  'tryCreate',
  'tryFinalize',
  'tryPrepare',
  'tryQuote',
  'tryWait',
  'verifyBundle',
  'wait',
];

function methodNames(resource: object): string[] {
  return Object.keys(resource).sort();
}

describe('cross-chain intent resource contract', () => {
  for (const kind of ['ethers', 'viem'] as const) {
    it(`${kind} preserves the deposits, withdrawals, and interop method sets`, () => {
      const harness = createAdapterHarness(kind);

      const deposits =
        kind === 'ethers'
          ? createEthersDepositsResource(harness.client)
          : createViemDepositsResource(harness.client);
      const withdrawals =
        kind === 'ethers'
          ? createEthersWithdrawalsResource(harness.client)
          : createViemWithdrawalsResource(harness.client);
      const interop =
        kind === 'ethers'
          ? createEthersInteropResource(harness.client)
          : createViemInteropResource(harness.client);

      expect(methodNames(deposits)).toEqual(DEPOSIT_METHODS);
      expect(methodNames(withdrawals)).toEqual(WITHDRAWAL_METHODS);
      expect(methodNames(interop)).toEqual(INTEROP_METHODS);
    });

    it(`${kind} keeps the low-level finalization factories available`, () => {
      const harness = createAdapterHarness(kind);

      const withdrawalServices =
        kind === 'ethers'
          ? createEthersFinalizationServices(harness.client)
          : createViemFinalizationServices(harness.client);
      const interopServices =
        kind === 'ethers'
          ? createEthersInteropFinalizationServices(harness.client)
          : createViemInteropFinalizationServices(harness.client);

      expect(typeof withdrawalServices.finalizeDeposit).toBe('function');
      expect(typeof interopServices.finalize).toBe('function');
    });
  }
});
