// examples/ethers/interop/send-native.ts
import { Interface, JsonRpcProvider, Wallet, parseEther } from 'ethers';
import {
  createEthersClient,
  createEthersSdk,
} from '../../../src/adapters/ethers';
import { type Address } from '../../../src/core';
import { AbiCoder } from "ethers";

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';
const PRIVATE_KEY =
  process.env.PRIVATE_KEY ?? '0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110';

const SRC_CHAIN_ID = 6565n;
const DST_CHAIN_ID = 6566n;

async function main() {
  debugger;
  if (!PRIVATE_KEY) throw new Error('Set your PRIVATE_KEY in env');

  // Providers:
  // - l2: source chain where we initiate the interop send
  // - l1: still required by client
  const l1 = new JsonRpcProvider(L1_RPC);
  const l2 = new JsonRpcProvider(SRC_L2_RPC);
  const abi = AbiCoder.defaultAbiCoder();

  // Signer must be funded on source L2 (client.l2)
  const signer = new Wallet(PRIVATE_KEY, l2);

  const client = await createEthersClient({
    l1: new JsonRpcProvider(L1_RPC),
    l2: new JsonRpcProvider(SRC_L2_RPC),
    signer: new Wallet(PRIVATE_KEY),
    chains: {
      [SRC_CHAIN_ID.toString()]: new JsonRpcProvider(SRC_L2_RPC), // register source too
      [DST_CHAIN_ID.toString()]: new JsonRpcProvider(DST_L2_RPC), // and destination
    },
  });
  const sdk = createEthersSdk(client);

  const me = (await signer.getAddress()) as Address;
  const recipientOnDst = me as Address;

  // Route selection ('direct' vs 'indirect') will be decided automatically
  // based on base token match & ERC20 usage.
  const params = {
    sender: me,
    dst: DST_CHAIN_ID,
    actions: [
      {
        type: 'sendNative' as const,
        to: recipientOnDst,
        amount: parseEther('0'),
      },
    ],
    // Optional bundle-level execution constraints:
    // execution: { only: someExecAddress },
    // unbundling: { by: someUnbundlerAddress },
  };


  // const data = abi.encode(["string"], ["hello from example!"]) as `0x${string}`;

  // const params = {
  //   sender: me,
  //   dst: DST_CHAIN_ID,
  //   actions: [
  //     {
  //       type: 'call' as const,
  //       to: '0xe441CF0795aF14DdB9f7984Da85CD36DB1B8790d' as `0x${string}`,
  //       data: data,
  //     },
  //   ],
  //   // Optional bundle-level execution constraints:
  //   // execution: { only: someExecAddress },
  //   // unbundling: { by: someUnbundlerAddress },
  // };

  // --------
  // 1. QUOTE
  // --------
  const quote = await sdk.interop.quote(params);
  console.log('QUOTE:', quote);
  // {
  //   route: 'direct' | 'indirect',
  //   approvalsNeeded: [],
  //   totalActionValue: ...,
  //   bridgedTokenTotal: ...,
  //   l1Fee?: ...,
  //   l2Fee?: ...
  // }

  // ---------
  // 2. PREPARE
  // ---------
  const prepared = await sdk.interop.prepare(params);
  console.log('PREPARE:', prepared);
  // {
  //   route: 'direct' | 'indirect',
  //   summary: <InteropQuote>,
  //   steps: [
  //     {
  //       key: 'sendBundle',
  //       kind: 'interop.center',
  //       description: 'Send interop bundle (...)',
  //       tx: { to, data, value, gasLimit?, ... }
  //     }
  //   ]
  // }

  // --------------
  // 3. CREATE
  // --------------
  const created = await sdk.interop.create(params);
  console.log('CREATE:', created);
  // {
  //   kind: 'interop',
  //   stepHashes: { sendBundle: '0xabc...' },
  //   plan: <the same plan we saw in prepare()>,
  //   l2SrcTxHash: '0xabc...',       // tx that emitted InteropBundleSent
  //   dstChainId: 260n,              // destination chain ID
  // }

  // --------------------------
  // 4. STATUS 
  // --------------------------
  const st0 = await sdk.interop.status(created);
  console.log('STATUS after create:', st0);
  // {
  //   phase: 'SENT' | 'VERIFIED' | 'EXECUTED' | ...,
  //   l2SrcTxHash?: '0x...',
  //   bundleHash?:  '0x...',
  //   dstChainId?:  260n,
  //   dstExecTxHash?: '0x...'
  // }

  // -------------------------------------------------
  // 5. WAIT FOR SOURCE FINALIZATION + DEST ROOT AVAILABILITY
  // -------------------------------------------------
  // This waits until the L2->L1 proof is available on source and the interop root
  // becomes available on the destination chain. It returns the proof payload needed
  // to execute the bundle later.
  const finalizationInfo = await sdk.interop.wait(created, {
    pollMs: 5_000,
    timeoutMs: 30 * 60 * 1_000,
  });
  console.log('Bundle is finalized on source; root available on destination.');

  // You can inspect updated status again here if you want:
  const st1 = await sdk.interop.status(created);
  console.log('STATUS after wait:', st1);
  // phase should be at least 'SENT' (execution depends on someone submitting the bundle)
  // st1.bundleHash should be known
  // st1.dstChainId should be known

  // -----------------------------------------------------
  // 6. FINALIZE (EXECUTE ON DESTINATION AND BLOCK UNTIL DONE)
  // -----------------------------------------------------
  // finalize() calls executeBundle(...) on the destination chain,
  // waits for the tx to mine, then returns { bundleHash, dstChainId, dstExecTxHash }.
  const fin = await sdk.interop.finalize(finalizationInfo);
  console.log('FINALIZE RESULT:', fin);
  // {
  //   bundleHash: '0x...',
  //   dstChainId: 260n,
  //   dstExecTxHash: '0x...'
  // }

  // After this point, the value should be delivered / available on dst.

  // --------------------------------
  // 7. STATUS (terminal: EXECUTED)
  // --------------------------------
  const st2 = await sdk.interop.status(created);
  console.log('STATUS after finalize:', st2);
  // phase should now be 'EXECUTED' (or 'UNBUNDLED' in partial-exec flows)
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
