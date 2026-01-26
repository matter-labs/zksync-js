import { AbiCoder, Contract, JsonRpcProvider, Wallet } from 'ethers';
import {
  createEthersClient,
  createEthersSdk,
} from '../../../src/adapters/ethers';
import { type Address } from '../../../src/core';
import { getGreetingTokenAddress } from './utils';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const GREETING_ABI = [
  'function message() view returns (string)',
] as const;

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set your PRIVATE_KEY in env');

  // Providers:
  // - l2: source chain where we initiate the interop send
  // - l1: still required by client
  const l1 = new JsonRpcProvider(L1_RPC);
  const l2Source = new JsonRpcProvider(SRC_L2_RPC);
  const l2Destination = new JsonRpcProvider(DST_L2_RPC);

  // Signer must be funded on source L2 (client.l2)
  const signer = new Wallet(PRIVATE_KEY, l2Source);

  const [srcNet, dstNet] = await Promise.all([l2Source.getNetwork(), l2Destination.getNetwork()]);

  const client = await createEthersClient({
    l1,
    l2: l2Source,
    signer,
    chains: {
      [srcNet.chainId.toString()]: l2Source,
      [dstNet.chainId.toString()]: l2Destination,
    },
  });
  const sdk = createEthersSdk(client);

  const me = (await signer.getAddress()) as Address;
  const dstSigner = new Wallet(PRIVATE_KEY, l2Destination);

  const l1Balance = await l1.getBalance(me);
  console.log('L1 balance:', l1Balance.toString());
  console.log('L2 source balance:', (await l2Source.getBalance(me)).toString());
  console.log('L2 destination balance:', (await l2Destination.getBalance(me)).toString());

  // ---- Deploy Greeter on destination ----
  console.log('\n=== DEPLOYING GREETER ON DESTINATION ===');
  const initialGreeting = 'hello from destination';
  const greeterAddress = await getGreetingTokenAddress({
    signer: dstSigner,
    greeting: initialGreeting,
  });
  console.log('Greeter deployed at:', greeterAddress);

  const greeter = new Contract(greeterAddress, GREETING_ABI, l2Destination);
  const greetingBefore = (await greeter.message()) as string;
  console.log('Greeting before:', greetingBefore);
  const newGreeting = 'hello from example!';
  const data = AbiCoder.defaultAbiCoder().encode(["string"], [newGreeting]) as `0x${string}`;

  const params = {
    sender: me,
    dst: dstNet.chainId,
    actions: [
      {
        type: 'call' as const,
        to: greeterAddress,
        data: data,
      },
    ],
    // Optional bundle-level execution constraints:
    // execution: { only: someExecAddress },
    // unbundling: { by: someUnbundlerAddress },
  };

  // --------
  // 1. QUOTE
  // --------
  // Build and return the summary.
  const quote = await sdk.interop.quote(params);
  console.log('QUOTE:', quote);

  // ---------
  // 2. PREPARE
  // ---------
  // Build plan without executing.
  const prepared = await sdk.interop.prepare(params);
  console.log('PREPARE:', prepared);

  // --------------
  // 3. CREATE
  // --------------
  // Execute the source-chain step(s), wait for each tx receipt to confirm (status != 0).
  const created = await sdk.interop.create(params);
  console.log('CREATE:', created);

  // --------------------------
  // 4. STATUS 
  // --------------------------
  // Non-blocking lifecycle inspection.
  const st0 = await sdk.interop.status(created);
  console.log('STATUS after create:', st0);

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
  // -----------------------------------------------------
  // 6. FINALIZE (EXECUTE ON DESTINATION AND BLOCK UNTIL DONE)
  // -----------------------------------------------------
  // finalize() calls executeBundle(...) on the destination chain,
  // waits for the tx to mine, then returns { bundleHash, dstChainId, dstExecTxHash }.
  const finalizationResult = await sdk.interop.finalize(finalizationInfo);
  console.log('FINALIZE RESULT:', finalizationResult);

  // --------------------------------
  // 7. STATUS (terminal: EXECUTED)
  // --------------------------------
  const st1 = await sdk.interop.status(created);
  console.log('STATUS after finalize:', st1);

  const greetingAfter = (await greeter.message()) as string;
  console.log('Greeting after:', greetingAfter);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
