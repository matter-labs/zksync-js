# Adapter Test Harness

## Overview

The specs in this directory exercise both the ethers and viem adapters through a shared harness. The harness:

- normalizes provider/signature behavior for each runtime
- exposes helpers for seeding contract responses and default contexts
- provides a `describeForAdapters` wrapper so every spec runs against both adapters without copy/paste loops.

Supporting utilities live alongside the tests:

- `adapter-harness.ts` – factories, context builders, viem/ethers mocks.
- `decode-helpers.ts` – ABI decode helpers used by the assertions.
- `utils.test.ts` – parity checks that the utility functions exported by ethers/viem adapters behave the same.

## Quick Start

A minimal adapter test looks like this:

```ts
import { describeForAdapters, makeDepositContext, setBridgehubBaseCost } from '../adapter-harness';
import { routeEthDirect } from '../../ethers/resources/deposits/routes/eth'; // same path works for viem variant

describeForAdapters('adapters/deposits/routeEthDirect', (kind, factory) => {
  it('builds a single bridge step', async () => {
    const harness = factory();
    const ctx = makeDepositContext(harness);
    setBridgehubBaseCost(harness, ctx, 1_000n);

    const res = await routeEthDirect()[kind === 'ethers' ? 'build' : 'build']({ amount: 1n } as any, ctx as any);
    expect(res.steps).toHaveLength(1);
  });
});
```

- The wrapper passes the adapter `kind` and a `factory(opts)` that spins up a harness for that runtime.
- Assertions typically rely on helper decode functions (`parseDirectBridgeTx`, `decodeAssetRouterWithdraw`, etc.) rather than manual ABI decoding.

## Harness Factories & Contexts

`describeForAdapters(label, callback, kinds?)`
: Runs `callback` for each adapter in `['ethers', 'viem']` (override via `kinds` if needed). Inside the callback call `const harness = factory(opts)` to create a harness. Useful options:

- `seed: false` – start with an empty registry (skip default bridgehub lookups).
- `overrides: Partial<ResolvedAddresses>` – inject custom bridgehub/asset router addresses.

Context builders:

- `makeDepositContext(harness, extras?)`
- `makeWithdrawalContext(harness, extras?)`

Each returns a mutable context object with sensible defaults. Pass an `extras` object to override fields (e.g. `{ baseIsEth: false }`).

## Seeding Helpers

Use these to populate the call registry before invoking adapter logic:

- `setBridgehubBaseCost(harness, ctx, value, overrides?)`
- `setBridgehubBaseToken(harness, { chainId }, address)`
- `setErc20Allowance(harness, token, owner, spender, amount)`
- `setL2TokenRegistration(harness, vault, token, assetId)`

`overrides` (for base cost) lets you specify custom `gasPriceForBaseCost`, `l2GasLimit`, etc., matching the call signature the route under test uses.

## Viem Simulation Queue

Viem routes often use `simulateContract`. Rather than hand-rolling responders in each test, use:

- `queueSimulateResponses(responses, target = 'l2')`

Each entry can be a function `(args) => ({ request, result })` or a plain object. Responses are consumed FIFO as the test calls `simulateContract`. For single-use overrides you can still call `setSimulateResponse`/`setSimulateError`.

## Decode Helpers

`decode-helpers.ts` exports utilities that parse common payloads:

- `parseDirectBridgeTx(kind, tx)` – normalizes the L2 direct bridge request.
- `decodeAssetRouterWithdraw(data)` – decodes `withdraw(bytes32,bytes)`.
- `decodeBaseTokenWithdraw(data)` – returns the refund recipient.
- `decodeSecondBridgeErc20(calldata)` and `decodeTwoBridgeOuter(data)` – for two-bridge flows.
- `parseApproveTx(kind, tx)` – normalizes ERC-20 approve calls.

Always prefer these helpers over re-declaring `new Interface(...)` blocks in tests.

## Tips for New Tests

- Seed contract responses using the helpers above before calling the adapter function (`build`, `preflight`, etc.).
- Assert against decoded structures or `quoteExtras` rather than raw calldata—this keeps expectations readable and adapter-agnostic.
- When viem routes need multiple simulations, enqueue them with `queueSimulateResponses([ responder1, responder2 ])` in the order they will be called.
- If a test requires custom harness setup (e.g. different default fee data), pass options to `factory(opts)` or mutate the harness (`harness.setEstimateGas(...)`).
- Run `bun test src/adapters/__tests__/...` to focus on adapter suites while iterating.

By following these patterns, new adapter tests stay succinct while covering both runtimes consistently.
