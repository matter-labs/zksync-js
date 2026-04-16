import { beforeAll, describe, it } from 'bun:test';

// ANCHOR: imports
import { createPublicClient, createWalletClient, http, type Account, type Chain, type Transport } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, createViemSdk } from '../../../../src/adapters/viem';
// ANCHOR_END: imports

import type { ViemSdk } from '../../../../src/adapters/viem';
import type { Address, Hex } from '../../../../src/core';

describe('viem interop reference', () => {

  let sdk: ViemSdk;

  beforeAll(() => {
// ANCHOR: init-sdk
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
const l2Src = createPublicClient({ transport: http(process.env.SRC_L2_RPC!) });
const l1Wallet = createWalletClient<Transport, Chain, Account>({
  account,
  transport: http(process.env.L1_RPC!),
});

const client = createViemClient({ l1, l2: l2Src, l1Wallet });
sdk = createViemSdk(client, {
  interop: { gwChain: process.env.GW_RPC! }, // required for interop
});
// sdk.interop → InteropResource
// ANCHOR_END: init-sdk
  });

  it('quick-start: send ERC-20 across chains', async () => {
    const l2Dst = createPublicClient({ transport: http(process.env.DST_L2_RPC!) });
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;

// ANCHOR: quick-start
const handle = await sdk.interop.create(l2Dst, {
  actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: 1_000_000n }],
});

const finalizationInfo = await sdk.interop.wait(l2Dst, handle);
const result = await sdk.interop.finalize(l2Dst, finalizationInfo);
// result.dstExecTxHash — tx hash on destination chain
// ANCHOR_END: quick-start
  });

  it('quote', async () => {
    const l2Dst = createPublicClient({ transport: http(process.env.DST_L2_RPC!) });
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;

// ANCHOR: quote
const q = await sdk.interop.quote(l2Dst, {
  actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: 1_000_000n }],
});
/*
{
  route: 'direct' | 'indirect',
  approvalsNeeded: [],
  totalActionValue: bigint,
  bridgedTokenTotal: bigint,
  interopFee: { token, amount },
  l2Fee?: bigint
}
*/
// ANCHOR_END: quote
  });

  it('prepare', async () => {
    const l2Dst = createPublicClient({ transport: http(process.env.DST_L2_RPC!) });
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;

// ANCHOR: prepare
const plan = await sdk.interop.prepare(l2Dst, {
  actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: 1_000_000n }],
});
/*
{
  route: 'direct' | 'indirect',
  summary: InteropQuote,
  steps: [
    { key: 'sendBundle', kind: 'sendBundle', description: '...', tx: ... }
  ]
}
*/
// ANCHOR_END: prepare
  });

  it('handle', async () => {
    const l2Dst = createPublicClient({ transport: http(process.env.DST_L2_RPC!) });
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;

// ANCHOR: handle
const handle = await sdk.interop.create(l2Dst, {
  actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: 1_000_000n }],
});
/*
{
  kind: 'interop',
  l2SrcTxHash: Hex,
  stepHashes: Record<string, Hex>,
  plan: InteropPlan
}
*/
// ANCHOR_END: handle
  });

  it('status', async () => {
    const l2Dst = createPublicClient({ transport: http(process.env.DST_L2_RPC!) });
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;
    const handle = await sdk.interop.create(l2Dst, {
      actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: 1_000_000n }],
    });

// ANCHOR: status
const st = await sdk.interop.status(l2Dst, handle);
// or: sdk.interop.status(l2Dst, handle.l2SrcTxHash)
// st.phase: 'SENT' | 'VERIFIED' | 'EXECUTED' | 'UNBUNDLED' | 'FAILED' | 'UNKNOWN'
// ANCHOR_END: status
  });

  it('wait', async () => {
    const l2Dst = createPublicClient({ transport: http(process.env.DST_L2_RPC!) });
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;
    const handle = await sdk.interop.create(l2Dst, {
      actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: 1_000_000n }],
    });

// ANCHOR: wait
const finalizationInfo = await sdk.interop.wait(l2Dst, handle, {
  pollMs: 5_000,
  timeoutMs: 30 * 60_000,
});
// finalizationInfo.bundleHash — interop bundle hash
// finalizationInfo.proof     — Merkle proof for execution
// ANCHOR_END: wait
  });

  it('finalize', async () => {
    const l2Dst = createPublicClient({ transport: http(process.env.DST_L2_RPC!) });
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;
    const handle = await sdk.interop.create(l2Dst, {
      actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: 1_000_000n }],
    });
    const finalizationInfo = await sdk.interop.wait(l2Dst, handle);

// ANCHOR: finalize
const result = await sdk.interop.finalize(l2Dst, finalizationInfo);
// { bundleHash: Hex, dstExecTxHash: Hex }

// Or pass a waitable — finalize() calls wait() internally:
// const result = await sdk.interop.finalize(l2Dst, handle);
// ANCHOR_END: finalize
  });

  it('e2e-erc20: ERC-20 transfer via interop', async () => {
    const l2Dst = createPublicClient({ transport: http(process.env.DST_L2_RPC!) });
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;

// ANCHOR: e2e-erc20
const handle = await sdk.interop.create(l2Dst, {
  actions: [
    {
      type: 'sendErc20',
      token: tokenSrcAddress,
      to: me,
      amount: 1_000_000n,
    },
  ],
  unbundling: { by: me },
});

const finalizationInfo = await sdk.interop.wait(l2Dst, handle, {
  pollMs: 5_000,
  timeoutMs: 30 * 60_000,
});

const result = await sdk.interop.finalize(l2Dst, finalizationInfo);
console.log('ERC-20 transferred to destination:', result.dstExecTxHash);
// ANCHOR_END: e2e-erc20
  });

  it('e2e-call: remote contract call via interop', async () => {
    const l2Dst = createPublicClient({ transport: http(process.env.DST_L2_RPC!) });
    const greeterAddress = process.env.GREETER_DST_ADDRESS! as Address;
    const calldata = '0xabcdef' as Hex;

// ANCHOR: e2e-call
const handle = await sdk.interop.create(l2Dst, {
  actions: [
    {
      type: 'call',
      to: greeterAddress,
      data: calldata,
    },
  ],
});

const finalizationInfo = await sdk.interop.wait(l2Dst, handle, {
  pollMs: 5_000,
  timeoutMs: 30 * 60_000,
});

const result = await sdk.interop.finalize(l2Dst, finalizationInfo);
console.log('Remote call executed on destination:', result.dstExecTxHash);
// ANCHOR_END: e2e-call
  });

  it('get-interop-root', async () => {
    const l2Dst = createPublicClient({ transport: http(process.env.DST_L2_RPC!) });

// ANCHOR: get-interop-root
// Fetch the interop root for a given source chain ID and batch number
const root = await sdk.interop.getInteropRoot(
  l2Dst,
  /* rootChainId */ 300n,   // source chain ID
  /* batchNumber */ 42n,    // batch number on the source chain
);
console.log('Interop root:', root); // 0x...
// ANCHOR_END: get-interop-root
  });

  it('verify-bundle', async () => {
    const l2Dst = createPublicClient({ transport: http(process.env.DST_L2_RPC!) });
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;
    const handle = await sdk.interop.create(l2Dst, {
      actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: 1_000_000n }],
    });

// ANCHOR: verify-bundle
// Verify the bundle on the destination chain without executing actions.
// Accepts an InteropHandle, InteropFinalizationInfo, or raw tx hash.
const result = await sdk.interop.verifyBundle(l2Dst, handle);
// { bundleHash: Hex, dstExecTxHash: Hex }
console.log('Bundle verified on destination:', result.dstExecTxHash);
// ANCHOR_END: verify-bundle
  });

});
