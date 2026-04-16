import { describe, it } from 'bun:test';

// ANCHOR: imports
import { createPublicClient, createWalletClient, http, type Account, type Chain, type Transport } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, createViemSdk } from '../../../../src/adapters/viem';

const L1_RPC = 'http://localhost:8545';   // e.g. https://sepolia.infura.io/v3/XXX
const GW_RPC = 'http://localhost:3052';   // gateway chain RPC
const SRC_L2_RPC = 'http://localhost:3050'; // source L2 RPC
const DST_L2_RPC = 'http://localhost:3051'; // destination L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const TOKEN_SRC_ADDRESS = process.env.TOKEN_SRC_ADDRESS || ''; // ERC-20 token on source L2
// ANCHOR_END: imports

describe('viem interop guide', () => {

it('sends ERC-20 across chains', async () => {
  await main();
});

});

// ANCHOR: main
async function main() {
  if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY in env');

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const me = account.address as `0x${string}`;

  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2Src = createPublicClient({ transport: http(SRC_L2_RPC) });
  const l2Dst = createPublicClient({ transport: http(DST_L2_RPC) });

  const l1Wallet = createWalletClient<Transport, Chain, Account>({
    account,
    transport: http(L1_RPC),
  });

  const client = createViemClient({ l1, l2: l2Src, l1Wallet });
  const sdk = createViemSdk(client, {
    interop: { gwChain: GW_RPC },
  });

  const params = {
    actions: [
      {
        type: 'sendErc20' as const,
        token: TOKEN_SRC_ADDRESS as `0x${string}`,
        to: me,
        amount: 1_000_000n,
      },
    ],
  };

  // ANCHOR: quote
  const quote = await sdk.interop.quote(l2Dst, params);
  // {
  //   route: 'direct' | 'indirect',
  //   approvalsNeeded: [{ token, spender, amount }], // ERC-20 approval needed
  //   totalActionValue: 0n,
  //   bridgedTokenTotal: 1_000_000n,
  //   interopFee: { token: '0x000...', amount: bigint },
  //   l2Fee?: bigint
  // }
  // ANCHOR_END: quote
  void quote;

  // ANCHOR: prepare
  const plan = await sdk.interop.prepare(l2Dst, params);
  // {
  //   route: 'direct' | 'indirect',
  //   summary: InteropQuote,
  //   steps: [{ key, kind, description, tx }]
  // }
  // ANCHOR_END: prepare
  void plan;

  // Send the interop bundle on source L2
  // ANCHOR: create
  const handle = await sdk.interop.create(l2Dst, params);
  // {
  //   kind: 'interop',
  //   l2SrcTxHash: Hex,
  //   stepHashes: Record<string, Hex>,
  //   plan: InteropPlan
  // }
  // ANCHOR_END: create

  // ANCHOR: status
  const st = await sdk.interop.status(l2Dst, handle);
  // st.phase: 'SENT' | 'VERIFIED' | 'EXECUTED' | 'UNBUNDLED' | 'FAILED' | 'UNKNOWN'
  // ANCHOR_END: status
  void st;

  // Wait until the bundle proof is available on destination
  // ANCHOR: wait
  const finalizationInfo = await sdk.interop.wait(l2Dst, handle, {
    pollMs: 5_000,
    timeoutMs: 30 * 60_000,
  });
  // Returns InteropFinalizationInfo once bundle proof is available on destination
  // ANCHOR_END: wait

  // Execute the bundle on destination L2
  // ANCHOR: finalize
  const result = await sdk.interop.finalize(l2Dst, finalizationInfo);
  // { bundleHash: Hex, dstExecTxHash: Hex }
  console.log('Executed on destination:', result.dstExecTxHash);
  // ANCHOR_END: finalize
}
// ANCHOR_END: main

// Alternative-pattern snippets for documentation — never executed during tests.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _snippets() {
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const me = account.address as `0x${string}`;
  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2Src = createPublicClient({ transport: http(SRC_L2_RPC) });
  const l2Dst = createPublicClient({ transport: http(DST_L2_RPC) });
  const l1Wallet = createWalletClient<Transport, Chain, Account>({ account, transport: http(L1_RPC) });
  const client = createViemClient({ l1, l2: l2Src, l1Wallet });
  const sdk = createViemSdk(client, { interop: { gwChain: GW_RPC } });
  const params = {
    actions: [
      { type: 'sendErc20' as const, token: TOKEN_SRC_ADDRESS as `0x${string}`, to: me, amount: 1_000_000n },
    ],
  };

// ANCHOR: try-catch-create
try {
  const handle = await sdk.interop.create(l2Dst, params);
  const finalizationInfo = await sdk.interop.wait(l2Dst, handle);
  const result = await sdk.interop.finalize(l2Dst, finalizationInfo);
  console.log('dstExecTxHash:', result.dstExecTxHash);
} catch (e) {
  console.error('Interop failed:', e);
}
// ANCHOR_END: try-catch-create

// ANCHOR: tryCreate
const createResult = await sdk.interop.tryCreate(l2Dst, params);
if (!createResult.ok) {
  console.error('Create failed:', createResult.error);
  return;
}
const handle = createResult.value;
// ANCHOR_END: tryCreate
  void handle;
}
