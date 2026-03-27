import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  type Account,
  type Chain,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, createViemSdk } from '../../../src/adapters/viem';
import { getGreetingAddress } from './utils';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const GW_RPC = process.env.GW_RPC ?? 'http://127.0.0.1:3052';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const GREETING_ABI = [
  {
    type: 'function',
    name: 'message',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
] as const;

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set your PRIVATE_KEY in env');

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2Source = createPublicClient({ transport: http(SRC_L2_RPC) });
  const l2Destination = createPublicClient({ transport: http(DST_L2_RPC) });

  const l1Wallet = createWalletClient<Transport, Chain, Account>({
    account,
    transport: http(L1_RPC),
  });

  const client = createViemClient({ l1, l2: l2Source, l1Wallet });
  const sdk = createViemSdk(client, { interop: { gwChain: GW_RPC } });

  // ---- Deploy Greeter on destination ----
  console.log('=== DEPLOYING GREETER ON DESTINATION ===');
  const initialGreeting = 'hello from destination';
  const greeterAddress = await getGreetingAddress({
    privateKey: PRIVATE_KEY as `0x${string}`,
    rpcUrl: DST_L2_RPC,
    greeting: initialGreeting,
  });
  console.log('Greeter deployed at:', greeterAddress);

  const greetingBefore = (await l2Destination.readContract({
    address: greeterAddress,
    abi: GREETING_ABI,
    functionName: 'message',
  })) as string;
  console.log('Greeting before:', greetingBefore);

  const newGreeting = 'hello from viem example!';
  const data = encodeAbiParameters([{ type: 'string' }], [newGreeting]) as `0x${string}`;

  const params = {
    actions: [
      {
        type: 'call' as const,
        to: greeterAddress,
        data,
      },
    ],
  };

  // QUOTE: Build and return the summary.
  const quote = await sdk.interop.quote(l2Destination, params);
  console.log('QUOTE:', quote);

  // PREPARE: Build plan without executing.
  const prepared = await sdk.interop.prepare(l2Destination, params);
  console.log('PREPARE:', prepared);

  // CREATE: Execute the source-chain step(s).
  const created = await sdk.interop.create(l2Destination, params);
  console.log('CREATE:', created);

  // STATUS: Non-blocking lifecycle inspection.
  const st0 = await sdk.interop.status(l2Destination, created);
  console.log('STATUS after create:', st0);

  // WAIT: Wait for proof and interop root availability.
  const finalizationInfo = await sdk.interop.wait(l2Destination, created, {
    pollMs: 5_000,
    timeoutMs: 30 * 60 * 1_000,
  });
  console.log('Bundle finalized on source; root available on destination.');

  // FINALIZE: Execute on destination chain.
  const finalizationResult = await sdk.interop.finalize(l2Destination, finalizationInfo);
  console.log('FINALIZE RESULT:', finalizationResult);

  // STATUS: Terminal status (EXECUTED).
  const st1 = await sdk.interop.status(l2Destination, created);
  console.log('STATUS after finalize:', st1);

  const greetingAfter = (await l2Destination.readContract({
    address: greeterAddress,
    abi: GREETING_ABI,
    functionName: 'message',
  })) as string;
  console.log('Greeting after:', greetingAfter);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
