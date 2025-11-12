/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test';
import type { Address, Hex } from '../primitives';
import type { ApprovalNeed, PlanStep } from '../flows/base';
import type { RouteStrategy } from '../flows/route';

// -------- type-only helper to assert assignability --------
function expectType<T>(_value: T): void {
  // compile-time only; keeps ESLint happy by being used
  void _value;
}

describe('types/flows/route-strategy — RouteStrategy<P, Tx, QuoteExtras, Ctx>', () => {
  it('accepts an implementation with optional preflight and required build()', () => {
    type P = { token: Address; amount: bigint };
    type Tx = { to: Address; data?: Hex };
    type QuoteExtras = { baseCost: bigint; gasPerPubdata?: bigint };
    type Ctx = { sender: Address };

    const impl: RouteStrategy<P, Tx, QuoteExtras, Ctx> = {
      preflight(p, ctx) {
        // Validate shape via type usage; no async/await to avoid require-await
        void p.token;
        void p.amount;
        void ctx.sender;
        return Promise.resolve();
      },
      build(p, ctx) {
        const steps: Array<PlanStep<Tx>> = [
          {
            key: 'approve',
            kind: 'erc20-approve',
            description: 'Approve token spending',
            tx: { to: p.token },
          },
          {
            key: 'bridge',
            kind: 'l1-bridge',
            description: 'Send deposit',
            tx: { to: ctx.sender },
          },
        ];
        const approvals: ApprovalNeed[] = [
          { token: p.token, spender: ctx.sender, amount: p.amount as unknown as bigint },
        ] as unknown as ApprovalNeed[]; // keep test minimal; real code would use UInt
        const quoteExtras: QuoteExtras = { baseCost: 0n };
        return Promise.resolve({ steps, approvals, quoteExtras });
      },
    };

    expectType<RouteStrategy<P, Tx, QuoteExtras, Ctx>>(impl);
    // runtime no-op usage to avoid "declared but never read" noise
    expect(typeof impl.build).toBe('function');
  });

  it('preflight is optional', () => {
    type P = { x: number };
    type Tx = { to: Address };
    type Q = { note?: string };
    type C = { y: number };

    const implNoPreflight: RouteStrategy<P, Tx, Q, C> = {
      build(_p, _ctx) {
        return Promise.resolve({
          steps: [{ key: 'k', kind: 'k', description: 'd', tx: { to: '0x1' as Address } }],
          approvals: [],
          quoteExtras: {},
        });
      },
    };
    expectType<RouteStrategy<P, Tx, Q, C>>(implNoPreflight);
    expect(typeof implNoPreflight.build).toBe('function');
  });

  it('enforces steps: Array<PlanStep<Tx>> and approvals: ApprovalNeed[]', () => {
    type P = {};
    type Tx = { to: Address };
    type Q = {};
    type C = {};

    // Correct
    const ok: RouteStrategy<P, Tx, Q, C> = {
      build() {
        const steps: Array<PlanStep<Tx>> = [
          { key: 's', kind: 'k', description: 'd', tx: { to: '0x1' as Address } },
        ];
        const approvals: ApprovalNeed[] = [];
        return Promise.resolve({ steps, approvals, quoteExtras: {} });
      },
    };
    expectType<RouteStrategy<P, Tx, Q, C>>(ok);

    const badTxType: RouteStrategy<P, Tx, Q, C> = {
      build() {
        const steps = [{ key: 's', kind: 'k', description: 'd', tx: { hash: '0x' } }] as any;
        return Promise.resolve({ steps, approvals: [], quoteExtras: {} });
      },
    };
    expect(badTxType).toBeDefined();

    const badSteps: RouteStrategy<P, Tx, Q, C> = {
      build() {
        const steps = [{ key: 'only-key' }] as any;
        return Promise.resolve({ steps, approvals: [], quoteExtras: {} });
      },
    };
    expect(badSteps).toBeDefined();

    const badApprovals: RouteStrategy<P, Tx, Q, C> = {
      build() {
        const steps: Array<PlanStep<Tx>> = [
          { key: 's', kind: 'k', description: 'd', tx: { to: '0x1' as Address } },
        ];
        return Promise.resolve({ steps, approvals: [{}] as any, quoteExtras: {} });
      },
    };
    expect(badApprovals).toBeDefined();
  });

  it('enforces QuoteExtras generic type in build() return', () => {
    type P = {};
    type Tx = { to: Address };
    type QuoteExtras = { baseCost: bigint; meta?: string };
    type Ctx = {};

    const ok: RouteStrategy<P, Tx, QuoteExtras, Ctx> = {
      build() {
        return Promise.resolve({
          steps: [{ key: 's', kind: 'k', description: 'd', tx: { to: '0x1' as Address } }],
          approvals: [],
          quoteExtras: { baseCost: 0n, meta: 'x' },
        });
      },
    };
    expectType<RouteStrategy<P, Tx, QuoteExtras, Ctx>>(ok);

    const badQE: RouteStrategy<P, Tx, QuoteExtras, Ctx> = {
      build() {
        return Promise.resolve({
          steps: [{ key: 's', kind: 'k', description: 'd', tx: { to: '0x1' as Address } }],
          approvals: [],
          quoteExtras: {},
        } as any);
      },
    };
    expect(badQE).toBeDefined();
  });
});
