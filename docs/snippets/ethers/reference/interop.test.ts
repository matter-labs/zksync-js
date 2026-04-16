import { beforeAll, describe, it } from 'bun:test';

// ANCHOR: imports
import { JsonRpcProvider, Wallet } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../../../src/adapters/ethers';
// ANCHOR_END: imports

import type { EthersSdk } from '../../../../src/adapters/ethers';
import type { Address, Hex } from '../../../../src/core';

// ANCHOR: params-type
type InteropRoute = 'direct' | 'indirect';

type InteropAction =
  | { type: 'sendErc20'; token: Address; to: Address; amount: bigint }
  | { type: 'call'; to: Address; data: Hex; value?: bigint };

interface InteropParams {
  actions: InteropAction[];
  execution?: { only: Address };
  unbundling?: { by: Address };
  fee?: { useFixed: boolean };
  txOverrides?: {
    nonce?: number;
    gasLimit?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  };
}
// ANCHOR_END: params-type

// ANCHOR: quote-type
interface InteropFee {
  token: Address;
  amount: bigint;
}

interface ApprovalNeed {
  token: Address;
  spender: Address;
  amount: bigint;
}

interface InteropQuote {
  route: InteropRoute;
  approvalsNeeded: readonly ApprovalNeed[];
  totalActionValue: bigint;
  bridgedTokenTotal: bigint;
  interopFee: InteropFee;
  l2Fee?: bigint;
}
// ANCHOR_END: quote-type

// ANCHOR: plan-type
interface PlanStep<Tx> {
  key: string;
  kind: string;
  description: string;
  tx: Tx;
}

interface InteropPlan<Tx> {
  route: InteropRoute;
  summary: InteropQuote;
  steps: Array<PlanStep<Tx>>;
}
// ANCHOR_END: plan-type

// ANCHOR: handle-type
interface InteropHandle<Tx> {
  kind: 'interop';
  l2SrcTxHash: Hex;
  l1MsgHash?: Hex;
  bundleHash?: Hex;
  dstExecTxHash?: Hex;
  stepHashes: Record<string, Hex>;
  plan: InteropPlan<Tx>;
}
// ANCHOR_END: handle-type

// ANCHOR: status-type
type InteropPhase =
  | 'SENT'       // bundle sent on source chain
  | 'VERIFIED'   // verified, ready for execution on destination
  | 'EXECUTED'   // all actions executed on destination
  | 'UNBUNDLED'  // actions selectively executed or cancelled
  | 'FAILED'     // execution reverted or invalid
  | 'UNKNOWN';   // status cannot be determined

interface InteropStatus {
  phase: InteropPhase;
  l2SrcTxHash?: Hex;
  l1MsgHash?: Hex;
  bundleHash?: Hex;
  dstExecTxHash?: Hex;
}
// ANCHOR_END: status-type

// ANCHOR: finalization-type
interface InteropMessageProof {
  chainId: bigint;
  l1BatchNumber: bigint;
  l2MessageIndex: bigint;
  message: {
    txNumberInBatch: number;
    sender: Address;
    data: Hex;
  };
  proof: Hex[];
}

interface InteropFinalizationInfo {
  l2SrcTxHash: Hex;
  bundleHash: Hex;
  dstChainId: bigint;
  proof: InteropMessageProof;
  encodedData: Hex;
}

interface InteropFinalizationResult {
  bundleHash: Hex;
  dstExecTxHash: Hex;
}
// ANCHOR_END: finalization-type

describe('ethers interop reference', () => {

  let sdk: EthersSdk;

  beforeAll(() => {
// ANCHOR: init-sdk
const l1 = new JsonRpcProvider(process.env.L1_RPC!);
const l2Src = new JsonRpcProvider(process.env.SRC_L2_RPC!);

const client = createEthersClient({
  l1,
  l2: l2Src,
  signer: new Wallet(process.env.PRIVATE_KEY!, l1),
});

sdk = createEthersSdk(client, {
  interop: { gwChain: process.env.GW_RPC! }, // required for interop
});
// sdk.interop → InteropResource
// ANCHOR_END: init-sdk
  });

  it('quick-start: send ERC-20 across chains', async () => {
    const signer = new Wallet(process.env.PRIVATE_KEY!);
    const me = (await signer.getAddress()) as Address;
    const l2Dst = new JsonRpcProvider(process.env.DST_L2_RPC!);
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
    const l2Dst = new JsonRpcProvider(process.env.DST_L2_RPC!);
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;

// ANCHOR: quote
const q = await sdk.interop.quote(l2Dst, {
  actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: 1_000_000n }],
});
/*
{
  route: 'direct' | 'indirect',
  approvalsNeeded: [],          // non-empty for ERC-20 actions
  totalActionValue: bigint,     // sum of all native value across actions
  bridgedTokenTotal: bigint,    // sum of ERC-20 amounts
  interopFee: { token, amount }, // fee charged by the interop protocol
  l2Fee?: bigint                // estimated L2 execution fee
}
*/
// ANCHOR_END: quote
  });

  it('prepare', async () => {
    const l2Dst = new JsonRpcProvider(process.env.DST_L2_RPC!);
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
    { key: 'sendBundle', kind: 'sendBundle', description: '...', tx: TransactionRequest }
  ]
}
*/
// ANCHOR_END: prepare
  });

  it('handle', async () => {
    const l2Dst = new JsonRpcProvider(process.env.DST_L2_RPC!);
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;

// ANCHOR: handle
const handle = await sdk.interop.create(l2Dst, {
  actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: 1_000_000n }],
});
/*
{
  kind: 'interop',
  l2SrcTxHash: Hex,              // tx hash on source L2
  stepHashes: Record<string, Hex>,
  plan: InteropPlan
}
*/
// ANCHOR_END: handle
  });

  it('status', async () => {
    const l2Dst = new JsonRpcProvider(process.env.DST_L2_RPC!);
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
    const l2Dst = new JsonRpcProvider(process.env.DST_L2_RPC!);
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
    const l2Dst = new JsonRpcProvider(process.env.DST_L2_RPC!);
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;
    const handle = await sdk.interop.create(l2Dst, {
      actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: 1_000_000n }],
    });
    const finalizationInfo = await sdk.interop.wait(l2Dst, handle);

// ANCHOR: finalize
const result = await sdk.interop.finalize(l2Dst, finalizationInfo);
// { bundleHash: Hex, dstExecTxHash: Hex }

// Alternatively, pass a waitable — finalize() calls wait() internally:
// const result = await sdk.interop.finalize(l2Dst, handle);
// ANCHOR_END: finalize
  });

  it('e2e-erc20: ERC-20 transfer via interop', async () => {
    const l2Dst = new JsonRpcProvider(process.env.DST_L2_RPC!);
    const me = '0x0000000000000000000000000000000000000001' as Address;
    const tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS! as Address;

// ANCHOR: e2e-erc20
// Transfer an ERC-20 token from source L2 to destination L2
const handle = await sdk.interop.create(l2Dst, {
  actions: [
    {
      type: 'sendErc20',
      token: tokenSrcAddress,
      to: me,
      amount: 1_000_000n, // e.g. 1 USDC (6 decimals)
    },
  ],
  unbundling: { by: me }, // allow recipient to unbundle
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
    const l2Dst = new JsonRpcProvider(process.env.DST_L2_RPC!);
    const greeterAddress = process.env.GREETER_DST_ADDRESS! as Address;
    const calldata = '0xabcdef' as Hex;

// ANCHOR: e2e-call
// Execute an arbitrary call on destination L2
const handle = await sdk.interop.create(l2Dst, {
  actions: [
    {
      type: 'call',
      to: greeterAddress,
      data: calldata,
      // value: 0n, // optional native value for payable calls
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
    const l2Dst = new JsonRpcProvider(process.env.DST_L2_RPC!);

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
    const l2Dst = new JsonRpcProvider(process.env.DST_L2_RPC!);
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
