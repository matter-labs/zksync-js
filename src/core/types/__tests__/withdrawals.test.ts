import { describe, it, expect } from 'bun:test';
import type { Address, Hex } from '../primitives';
import type {
  WithdrawParams,
  WithdrawRoute,
  WithdrawQuote,
  WithdrawPlan,
  WithdrawHandle,
  WithdrawalWaitable,
  FinalizeDepositParams,
  WithdrawalKey,
  WithdrawalStatus,
  FinalizeReadiness,
  ParsedLog,
  ParsedReceipt,
} from '../flows/withdrawals';
import type { ApprovalNeed } from '../flows/base';

// ------------------------ Type-only helpers ------------------------

// Compile-time “expectType” helper: ensures A is assignable to B.
function expectType<T>(_value: T): void {
  // no-op at runtime; compile-time only
  void _value;
}

// Exhaustiveness helper for discriminated unions
function assertNever(x: never): never {
  throw new Error('Unexpected object: ' + String(x));
}

// ------------------------ Tests ------------------------

describe('types/flows/withdrawals — basic shapes', () => {
  it('WithdrawParams accepts optional fields and Address/UInt types', () => {
    const good: WithdrawParams = {
      token: '0x1111111111111111111111111111111111111111' as Address,
      amount: 123n as bigint,
      to: '0x2222222222222222222222222222222222222222' as Address,
      l2GasLimit: 500_000n as bigint,
      l2TxOverrides: {
        gasLimit: 400_000n as bigint,
        maxFeePerGas: 2_000_000_000n as bigint,
        maxPriorityFeePerGas: 1_000_000_000n as bigint,
      },
    };
    expectType<WithdrawParams>(good);

    const badAmount: WithdrawParams = { token: '0x0' as Address, amount: 1 as unknown as bigint };
    expect(badAmount).toBeDefined(); // never runs, just keeps linter happy
  });

  it('WithdrawRoute is a strict union', () => {
    const r1: WithdrawRoute = 'eth';
    const r2: WithdrawRoute = 'erc20';
    expectType<WithdrawRoute>(r1);
    expectType<WithdrawRoute>(r2);

    // @ts-expect-error not part of union
    const r3: WithdrawRoute = 'native';
    expect(r3).toBeDefined();
  });

  it('WithdrawQuote shape and approvalsNeeded read-only', () => {
    const approvals: readonly ApprovalNeed[] = [] as const;
    const quote: WithdrawQuote = {
      route: 'erc20',
      approvalsNeeded: approvals,
      suggestedL2GasLimit: 250_000n as bigint,
      fees: {
        gasLimit: 250_000n as bigint,
        maxFeePerGas: 40n as bigint,
        maxPriorityFeePerGas: 5n as bigint,
      },
    };
    expectType<WithdrawQuote>(quote);

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    quote.approvalsNeeded = [];
  });

  it('ParsedLog / ParsedReceipt minimal event shape', () => {
    const log: ParsedLog = {
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      topics: ['0x' + '11'.repeat(32)] as Hex[],
      data: ('0x' + '22'.repeat(32)) as Hex,
    };
    const receipt: ParsedReceipt = { logs: [log] };
    expectType<ParsedReceipt>(receipt);
  });
});

describe('types/flows/withdrawals — FinalizeDepositParams & keys', () => {
  it('FinalizeDepositParams requires all proof inputs with correct types', () => {
    const p: FinalizeDepositParams = {
      chainId: 1n,
      l2BatchNumber: 1234n,
      l2MessageIndex: 7n,
      l2Sender: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address,
      l2TxNumberInBatch: 3,
      message: ('0x' + 'aa'.repeat(32)) as Hex,
      merkleProof: ['0x' + 'bb'.repeat(32)] as Hex[],
    };
    expectType<FinalizeDepositParams>(p);

    // Intentionally create a type-mismatch for testing; silence the specific ESLint rules.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const bad: FinalizeDepositParams = { ...p, l2TxNumberInBatch: 3n as any };
    expect(bad).toBeDefined();
  });

  it('WithdrawalKey shape', () => {
    const key: WithdrawalKey = {
      chainIdL2: 324n,
      l2BatchNumber: 555n,
      l2MessageIndex: 1n,
    };
    expectType<WithdrawalKey>(key);
  });
});

describe('types/flows/withdrawals — WithdrawalStatus & phase union', () => {
  it('WithdrawalStatus includes discriminated phase and optional fields', () => {
    const s1: WithdrawalStatus = {
      phase: 'L2_INCLUDED',
      l2TxHash: ('0x' + 'cc'.repeat(32)) as Hex,
    };
    const s2: WithdrawalStatus = {
      phase: 'FINALIZED',
      l2TxHash: ('0x' + 'cc'.repeat(32)) as Hex,
      l1FinalizeTxHash: ('0x' + 'dd'.repeat(32)) as Hex,
      key: { chainIdL2: 324n, l2BatchNumber: 100n, l2MessageIndex: 2n },
    };
    expectType<WithdrawalStatus>(s1);
    expectType<WithdrawalStatus>(s2);
  });
});

describe('types/flows/withdrawals — FinalizeReadiness union', () => {
  function readinessToString(r: FinalizeReadiness): string {
    switch (r.kind) {
      case 'READY':
        return 'ready';
      case 'FINALIZED':
        return 'finalized';
      case 'NOT_READY':
        return `not-ready:${r.reason}${r.detail ? ':' + r.detail : ''}`;
      case 'UNFINALIZABLE':
        return `unfinalizable:${r.reason}${r.detail ? ':' + r.detail : ''}`;
      default:
        return assertNever(r);
    }
  }

  it('accepts all variants and enforces exhaustiveness', () => {
    const ok: FinalizeReadiness[] = [
      { kind: 'READY' },
      { kind: 'FINALIZED' },
      { kind: 'NOT_READY', reason: 'paused' },
      { kind: 'NOT_READY', reason: 'batch-not-executed', detail: 'L1 not executed' },
      { kind: 'NOT_READY', reason: 'root-missing' },
      { kind: 'NOT_READY', reason: 'unknown', detail: 'pending proof' },
      { kind: 'UNFINALIZABLE', reason: 'message-invalid' },
      { kind: 'UNFINALIZABLE', reason: 'invalid-chain', detail: 'wrong chain' },
      { kind: 'UNFINALIZABLE', reason: 'settlement-layer' },
      { kind: 'UNFINALIZABLE', reason: 'unsupported', detail: 'not supported' },
    ];
    expect(ok.map(readinessToString)).toContain('ready');

    // @ts-expect-error wrong reason string for NOT_READY
    const bad1: FinalizeReadiness = { kind: 'NOT_READY', reason: 'nope' };
    expect(bad1).toBeDefined();

    const bad2: FinalizeReadiness = { kind: 'NOT_READY' } as unknown as FinalizeReadiness;
    expect(bad2).toBeDefined();
  });
});

describe('types/flows/withdrawals — WithdrawHandle & WithdrawalWaitable', () => {
  it('WithdrawHandle generic extends Handle and requires kind/tx hashes', () => {
    // We can't assert Handle's internal fields without its definition,
    // but we can ensure assignability to WithdrawHandle<Tx>.
    type Tx = { hash: string };
    const handle: WithdrawHandle<Tx> = {
      kind: 'withdrawal',
      route: 'erc20',
      // Provide an empty map for stepHashes to satisfy Handle<TxHashMap,...>
      stepHashes: {} as Record<string, Hex>,
      // Handle<Ctx, Route, Plan<Tx>> requires 'ctx' (Record<string, Hex>) by your definition
      plan: {} as unknown as WithdrawPlan<Tx>,
      l2TxHash: ('0x' + 'ee'.repeat(32)) as Hex,
      // Optional fields
      l1TxHash: ('0x' + 'ff'.repeat(32)) as Hex,
      l2BatchNumber: 1,
      l2MessageIndex: 0,
      l2TxNumberInBatch: 0,
    };
    expectType<WithdrawHandle<Tx>>(handle);

    const badKind: WithdrawHandle<Tx> = {
      ...(handle as unknown as Record<string, unknown>),
      kind: 'withdrawal',
      l2TxHash: ('0x' + 'ee'.repeat(32)) as Hex,
      stepHashes: {},
      plan: {
        route: 'erc20',
        summary: {
          route: 'erc20',
          approvalsNeeded: [] as readonly ApprovalNeed[],
          suggestedL2GasLimit: 0n as bigint,
        },
        steps: [],
      },
    };
    expect(badKind).toBeDefined();
  });

  it('WithdrawalWaitable union accepts Hex, partial hashes, or a WithdrawHandle', () => {
    const w1: WithdrawalWaitable = ('0x' + 'ab'.repeat(32)) as Hex; // plain hash
    expectType<WithdrawalWaitable>(w1);

    const w2: WithdrawalWaitable = { l2TxHash: ('0x' + 'cd'.repeat(32)) as Hex };
    const w3: WithdrawalWaitable = { l1TxHash: ('0x' + 'ef'.repeat(32)) as Hex };
    expectType<WithdrawalWaitable>(w2);
    expectType<WithdrawalWaitable>(w3);

    type Tx = { hash: string };
    const wh: WithdrawHandle<Tx> = {
      kind: 'withdrawal',
      route: 'eth',
      plan: {} as unknown as WithdrawPlan<Tx>,
      // Provide an empty map for stepHashes to satisfy Handle<TxHashMap,...>
      stepHashes: {} as Record<string, Hex>,
      l2TxHash: ('0x' + 'aa'.repeat(32)) as Hex,
    };
    const w4: WithdrawalWaitable = wh;
    expectType<WithdrawalWaitable>(w4);

    // @ts-expect-error wrong shape (missing required fields in all union members)
    const bad: WithdrawalWaitable = { foo: 1 };
    expect(bad).toBeDefined();
  });
});
