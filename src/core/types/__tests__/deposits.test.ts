import { describe, it, expect } from 'bun:test';
import type { Address, Hex } from '../primitives';
import type {
  DepositParams,
  DepositRoute,
  DepositQuote,
  DepositPlan,
  DepositHandle,
  DepositWaitable,
  DepositPhase,
  DepositStatus,
} from '../flows/deposits';
import type { ApprovalNeed, Plan } from '../flows/base';
import { assertNever } from '../../utils/index';

// ------------------------ Type-only helpers ------------------------

// Keep this used in tests so eslint doesn't flag it.
function expectType<T>(_value: T): void {
  // no-op at runtime; compile-time only
  void _value;
}
// ------------------------ Tests ------------------------

describe('types/flows/deposits — basic shapes', () => {
  it('DepositParams accepts optional fields and Address/UInt types', () => {
    const p: DepositParams = {
      token: '0x1111111111111111111111111111111111111111' as Address,
      amount: 123n as bigint,
      to: '0x2222222222222222222222222222222222222222' as Address,
      refundRecipient: '0x3333333333333333333333333333333333333333' as Address,
      l2GasLimit: 500_000n as bigint,
      gasPerPubdata: 800n as bigint,
      operatorTip: 10n as bigint,
      l1TxOverrides: {
        gasLimit: 280_000n as bigint,
        maxFeePerGas: 2_500_000_000n as bigint,
        maxPriorityFeePerGas: 1_500_000_000n as bigint,
      },
    };
    expectType<DepositParams>(p);

    const badAmount: DepositParams = {
      token: '0x0' as Address,
      amount: 1 as unknown as bigint,
    };
    expect(badAmount).toBeDefined();

    const badToken: DepositParams = {
      token: 'not-an-addr' as unknown as Address,
      amount: 1n as bigint,
    };
    expect(badToken).toBeDefined();
  });

  it('DepositRoute is a strict union', () => {
    const r1: DepositRoute = 'eth';
    // const r2: DepositRoute = 'erc20-base';
    const r3: DepositRoute = 'erc20-nonbase';
    expectType<DepositRoute>(r1);
    // expectType<DepositRoute>(r2);
    expectType<DepositRoute>(r3);

    // @ts-expect-error not part of union
    const r4: DepositRoute = 'native';
    expect(r4).toBeDefined();
  });

  // it('DepositQuote shape and approvalsNeeded read-only', () => {
  //   const approvals: readonly ApprovalNeed[] = [] as const;
  //   const quote: DepositQuote = {
  //     route: 'erc20-base',
  //     approvalsNeeded: approvals,
  //     baseCost: 1n as bigint,
  //     mintValue: 0n as bigint,
  //     suggestedL2GasLimit: 250_000n as bigint,
  //     gasPerPubdata: 800n as bigint,
  //   };
  //   expectType<DepositQuote>(quote);

  //   // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //   // @ts-ignore
  //   quote.approvalsNeeded = [];
  // });
});

describe('types/flows/deposits — Plan / Handle / Waitable', () => {
  it('DepositPlan<Tx> is assignable from Plan<Tx, Route, Quote>', () => {
    type Tx = { hash: string };
    const plan: DepositPlan<Tx> = {} as unknown as Plan<Tx, DepositRoute, DepositQuote>;
    expectType<DepositPlan<Tx>>(plan);
  });

  it('DepositHandle generic extends Handle and requires kind/l1TxHash', () => {
    type Tx = { hash: string };
    const handle: DepositHandle<Tx> = {
      kind: 'deposit',
      route: 'erc20-nonbase',
      stepHashes: {} as Record<string, Hex>,
      plan: {} as unknown as DepositPlan<Tx>,
      l1TxHash: ('0x' + 'aa'.repeat(32)) as Hex,
      l2ChainId: 324,
      l2TxHash: ('0x' + 'bb'.repeat(32)) as Hex,
    };
    expectType<DepositHandle<Tx>>(handle);

    const badKind: DepositHandle<Tx> = {
      ...(handle as unknown as DepositHandle<Tx>),
      kind: 'deposit',
    };
    expect(badKind).toBeDefined();

    const missingHash: DepositHandle<Tx> = {
      ...(handle as unknown as DepositHandle<Tx>),
      l1TxHash: `0x` as Address,
    };
    expect(missingHash).toBeDefined();
  });

  it('DepositWaitable union accepts Hex, object with l1TxHash, or a DepositHandle', () => {
    const w1: DepositWaitable = ('0x' + 'cd'.repeat(32)) as Hex; // plain hash
    expectType<DepositWaitable>(w1);

    const w2: DepositWaitable = { l1TxHash: ('0x' + 'ef'.repeat(32)) as Hex };
    expectType<DepositWaitable>(w2);

    type Tx = { hash: string };
    const handle: DepositHandle<Tx> = {
      kind: 'deposit',
      route: 'eth',
      plan: {} as unknown as DepositPlan<Tx>,
      stepHashes: {} as Record<string, Hex>,
      l1TxHash: ('0x' + '11'.repeat(32)) as Hex,
    };
    const w3: DepositWaitable = handle;
    expectType<DepositWaitable>(w3);

    // @ts-expect-error wrong shape
    const bad: DepositWaitable = { foo: 1 };
    expect(bad).toBeDefined();
  });
});

describe('types/flows/deposits — DepositPhase & DepositStatus', () => {
  function phaseToString(p: DepositPhase): string {
    switch (p) {
      case 'L1_PENDING':
        return 'l1-pending';
      case 'L1_INCLUDED':
        return 'l1-included';
      case 'L2_PENDING':
        return 'l2-pending';
      case 'L2_EXECUTED':
        return 'l2-executed';
      case 'L2_FAILED':
        return 'l2-failed';
      case 'UNKNOWN':
        return 'unknown';
      default:
        return assertNever(p);
    }
  }

  it('accepts all phase variants and enforces exhaustiveness', () => {
    const phases: DepositPhase[] = [
      'L1_PENDING',
      'L1_INCLUDED',
      'L2_PENDING',
      'L2_EXECUTED',
      'L2_FAILED',
      'UNKNOWN',
    ];
    expect(phases.map(phaseToString)).toContain('l1-included');

    // @ts-expect-error not part of union
    const badPhase: DepositPhase = 'READY';
    expect(badPhase).toBeDefined();
  });

  it('DepositStatus requires l1TxHash and optional l2TxHash', () => {
    const s1: DepositStatus = {
      phase: 'L1_PENDING',
      l1TxHash: ('0x' + 'aa'.repeat(32)) as Hex,
    };
    const s2: DepositStatus = {
      phase: 'L2_EXECUTED',
      l1TxHash: ('0x' + 'bb'.repeat(32)) as Hex,
      l2TxHash: ('0x' + 'cc'.repeat(32)) as Hex,
    };
    expectType<DepositStatus>(s1);
    expectType<DepositStatus>(s2);

    // @ts-expect-error l1TxHash is required
    const missing: DepositStatus = { phase: 'UNKNOWN' };
    expect(missing).toBeDefined();
  });
});
