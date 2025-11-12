import { describe, it, expect } from 'bun:test';
import type { Address, Hex } from '../primitives';
import type { ApprovalNeed, PlanStep, Plan, Handle, Waitable, CommonCtx } from '../flows/base';

// ------------------------ Type-only helpers ------------------------

function expectType<T>(_value: T): void {
  void _value;
}

// ------------------------ Tests ------------------------

describe('types/flows/base — ApprovalNeed', () => {
  it('has token, spender, amount with correct primitive types', () => {
    const a: ApprovalNeed = {
      token: '0x1111111111111111111111111111111111111111' as Address,
      spender: '0x2222222222222222222222222222222222222222' as Address,
      amount: 123n as bigint,
    };
    expectType<ApprovalNeed>(a);

    const bad1: ApprovalNeed = {
      token: 'not-hex' as unknown as Address,
      spender: '0x0' as Address,
      amount: 1n as bigint,
    };
    expect(bad1).toBeDefined();

    const bad2: ApprovalNeed = {
      token: '0x1' as Address,
      spender: '0x2' as Address,
      amount: 1 as unknown as bigint,
    };
    expect(bad2).toBeDefined();
  });
});

describe('types/flows/base — PlanStep<Tx>', () => {
  it('binds Tx type for the tx field', () => {
    type Tx = { to: Address; data?: Hex };
    const s: PlanStep<Tx> = {
      key: 'approve',
      kind: 'erc20-approve',
      description: 'Approve token spending',
      tx: { to: '0x3333333333333333333333333333333333333333' as Address, data: '0x' as Hex },
    };
    expectType<PlanStep<Tx>>(s);

    const bad: PlanStep<Tx> = {
      key: 'approve',
      kind: 'erc20-approve',
      description: 'Approve token spending',
      tx: '0xabc' as `0x${string}` as unknown as Tx,
    };
    expect(bad).toBeDefined();
  });
});

describe('types/flows/base — Plan<Tx, Route, Quote>', () => {
  it('composes route, summary(quote), steps', () => {
    type Tx = { to: Address };
    type Route = 'eth' | 'erc20';
    type Quote = { route: Route; baseCost: bigint };

    const p: Plan<Tx, Route, Quote> = {
      route: 'erc20',
      summary: { route: 'erc20', baseCost: 0n as bigint },
      steps: [
        {
          key: 'approve',
          kind: 'erc20-approve',
          description: 'Approve',
          tx: { to: '0x1' as Address },
        },
        { key: 'send', kind: 'bridge', description: 'Send', tx: { to: '0x2' as Address } },
      ],
    };
    expectType<Plan<Tx, Route, Quote>>(p);

    const bad: Plan<Tx, Route, Quote> = {
      route: p.route,
      summary: p.summary,
      steps: [{ key: 'x', kind: 'y', description: 'z', tx: { to: '0x3' as Address } }],
    };
    expect(bad).toBeDefined();
  });
});

describe('types/flows/base — Handle<TxHashMap, Route, PlanT>', () => {
  it('requires kind union and accepts optional route', () => {
    type Tx = { to: Address };
    type Route = 'eth' | 'erc20';
    type Quote = { route: Route; baseCost: bigint };
    type MyPlan = Plan<Tx, Route, Quote>;

    type Hashes = { approve: Hex; send: Hex };
    const h: Handle<Hashes, Route, MyPlan> = {
      kind: 'deposit', // or "withdrawal"
      route: 'eth',
      stepHashes: {
        approve: ('0x' + 'aa'.repeat(32)) as Hex,
        send: ('0x' + 'bb'.repeat(32)) as Hex,
      },
      plan: {
        route: 'eth',
        summary: { route: 'eth', baseCost: 0n as bigint },
        steps: [{ key: 'send', kind: 'bridge', description: 'Send', tx: { to: '0x1' as Address } }],
      },
    };
    expectType<Handle<Hashes, Route, MyPlan>>(h);

    // @ts-expect-error invalid kind literal
    const badKind: Handle<Hashes, Route, MyPlan> = { ...h, kind: 'finalize' };
    expect(badKind).toBeDefined();

    const badMap: Handle<Hashes, Route, MyPlan> = {
      ...h,
      stepHashes: { unknown: '0x' as Hex } as unknown as Hashes,
    };
    expect(badMap).toBeDefined();
  });
});

describe('types/flows/base — Waitable<HashKey>', () => {
  it("default key 'txHash': allows Hex, { txHash }, partial { txHash? }, or { stepHashes? }", () => {
    const w1: Waitable = ('0x' + 'cc'.repeat(32)) as Hex;
    expectType<Waitable>(w1);

    const w2: Waitable = { txHash: ('0x' + 'dd'.repeat(32)) as Hex };
    const w3: Waitable = { txHash: undefined }; // allowed by union
    const w4: Waitable = { stepHashes: { step1: ('0x' + 'ee'.repeat(32)) as Hex } };
    expectType<Waitable>(w2);
    expectType<Waitable>(w3);
    expectType<Waitable>(w4);

    const bad: Waitable = { l1TxHash: '0x' as Hex } as unknown as Waitable;
    expect(bad).toBeDefined();
  });

  it("custom key (e.g., 'l1TxHash') is enforced", () => {
    type W = Waitable<'l1TxHash'>;

    const a: W = ('0x' + '11'.repeat(32)) as Hex; // plain hash still OK
    const b: W = { l1TxHash: ('0x' + '22'.repeat(32)) as Hex };
    const c: W = { l1TxHash: undefined };
    const d: W = { stepHashes: { s: ('0x' + '33'.repeat(32)) as Hex } };
    expectType<W>(a);
    expectType<W>(b);
    expectType<W>(c);
    expectType<W>(d);

    // @ts-expect-error txHash is not valid for Waitable<'l1TxHash'>
    const wrong: W = { txHash: ('0x' + '44'.repeat(32)) as Hex };
    expect(wrong).toBeDefined();
  });
});

describe('types/flows/base — CommonCtx', () => {
  it('requires sender, chainIdL2, bridgehub', () => {
    const ctx: CommonCtx = {
      sender: '0x9999999999999999999999999999999999999999' as Address,
      chainIdL2: 324n,
      bridgehub: '0x8888888888888888888888888888888888888888' as Address,
    };
    expectType<CommonCtx>(ctx);
  });
});
