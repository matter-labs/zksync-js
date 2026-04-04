import { describe, it } from 'bun:test';

// ANCHOR: imports
import { JsonRpcProvider, Wallet } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../../../src/adapters/ethers';

const L1_RPC = 'http://localhost:8545';   // e.g. https://sepolia.infura.io/v3/XXX
const GW_RPC = 'http://localhost:3052';   // gateway chain RPC
const SRC_L2_RPC = 'http://localhost:3050'; // source L2 RPC
const DST_L2_RPC = 'http://localhost:3051'; // destination L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const TOKEN_SRC_ADDRESS = process.env.TOKEN_SRC_ADDRESS || ''; // ERC-20 token on source L2
// ANCHOR_END: imports

describe('ethers interop guide', () => {

it('sends ERC-20 across chains', async () => {
  await main();
});

});

// ANCHOR: main
async function main() {
  if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY in env');

  const l1 = new JsonRpcProvider(L1_RPC);
  const l2Src = new JsonRpcProvider(SRC_L2_RPC);
  const l2Dst = new JsonRpcProvider(DST_L2_RPC);

  const signer = new Wallet(PRIVATE_KEY);
  const client = createEthersClient({ l1, l2: l2Src, signer });
  const sdk = createEthersSdk(client, {
    interop: { gwChain: GW_RPC },
  });

  const me = (await signer.getAddress()) as `0x${string}`;
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

  // Send the interop bundle on source L2
  const handle = await sdk.interop.create(l2Dst, params);
  console.log('Source L2 tx:', handle.l2SrcTxHash);

  // Wait until the bundle proof is available on destination
  const finalizationInfo = await sdk.interop.wait(l2Dst, handle, {
    pollMs: 5_000,
    timeoutMs: 30 * 60_000,
  });

  // Execute the bundle on destination L2
  const result = await sdk.interop.finalize(l2Dst, finalizationInfo);
  console.log('Executed on destination:', result.dstExecTxHash);
}
// ANCHOR_END: main

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

// ANCHOR: prepare
const plan = await sdk.interop.prepare(l2Dst, params);
// {
//   route: 'direct' | 'indirect',
//   summary: InteropQuote,
//   steps: [{ key, kind, description, tx: TransactionRequest }]
// }
// ANCHOR_END: prepare

// ANCHOR: create
const handle = await sdk.interop.create(l2Dst, params);
// {
//   kind: 'interop',
//   l2SrcTxHash: Hex,  // tx hash on source L2
//   stepHashes: Record<string, Hex>,
//   plan: InteropPlan
// }
// ANCHOR_END: create

// ANCHOR: status
const st = await sdk.interop.status(l2Dst, handle);
// st.phase: 'SENT' | 'VERIFIED' | 'EXECUTED' | 'UNBUNDLED' | 'FAILED' | 'UNKNOWN'
// ANCHOR_END: status

// ANCHOR: wait
const finalizationInfo = await sdk.interop.wait(l2Dst, handle, {
  pollMs: 5_000,       // how often to poll (ms), default 5000
  timeoutMs: 30 * 60_000, // max wait time (ms)
});
// Returns InteropFinalizationInfo once bundle proof is available on destination
// ANCHOR_END: wait

// ANCHOR: finalize
const result = await sdk.interop.finalize(l2Dst, finalizationInfo);
// { bundleHash: Hex, dstExecTxHash: Hex }
console.log('Executed on destination:', result.dstExecTxHash);
// ANCHOR_END: finalize

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
