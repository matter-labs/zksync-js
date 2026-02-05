import { createPublicClient, createWalletClient, encodeAbiParameters, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createViemClient, createViemSdk } from '../../../src/adapters/viem';
import type { Address } from '../../../src/core/types/primitives';
import { getGreetingTokenAddress } from './utils';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const GREETING_ABI = [
  {
    type: 'function',
    name: 'message',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const;

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set your PRIVATE_KEY in env');

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2Source = createPublicClient({ transport: http(SRC_L2_RPC) });
  const l2Destination = createPublicClient({ transport: http(DST_L2_RPC) });

  const l1Wallet = createWalletClient({ account, transport: http(L1_RPC) });
  const l2Wallet = createWalletClient({ account, transport: http(SRC_L2_RPC) });
  const l2WalletDst = createWalletClient({ account, transport: http(DST_L2_RPC) });

  const [srcChainId, dstChainId] = await Promise.all([
    l2Source.getChainId(),
    l2Destination.getChainId(),
  ]);

  const client = createViemClient({
    l1,
    l2: l2Source,
    l1Wallet,
    l2Wallet,
  });
  client.registerChain(BigInt(dstChainId), l2Destination);

  const sdk = createViemSdk(client);

  const me = account.address as Address;

  const l1Balance = await l1.getBalance({ address: me });
  console.log('L1 balance:', l1Balance.toString());
  console.log('L2 source balance:', (await l2Source.getBalance({ address: me })).toString());
  console.log(
    'L2 destination balance:',
    (await l2Destination.getBalance({ address: me })).toString(),
  );

  // ---- Deploy Greeting on destination ----
  console.log('=== DEPLOYING GREETER ON DESTINATION ===');
  const initialGreeting = 'hello from destination';
  const greeterAddress = await getGreetingTokenAddress({
    wallet: l2WalletDst,
    publicClient: l2Destination,
    greeting: initialGreeting,
  });
  console.log('Greeter deployed at:', greeterAddress);

  const greetingBefore = (await l2Destination.readContract({
    address: greeterAddress,
    abi: GREETING_ABI,
    functionName: 'message',
  })) as string;
  console.log('Greeting before:', greetingBefore);

  const newGreeting = 'hello from example!';
  const data = encodeAbiParameters([{ type: 'string', name: 'greeting' }], [newGreeting]);

  const params = {
    sender: me,
    dstChainId: BigInt(dstChainId),
    actions: [
      {
        type: 'call' as const,
        to: greeterAddress,
        data,
      },
    ],
  };

  const quote = await sdk.interop.quote(params);
  console.log('QUOTE:', quote);

  const prepared = await sdk.interop.prepare(params);
  console.log('PREPARE:', prepared);

  const created = await sdk.interop.create(params);
  console.log('CREATE:', created);

  const st0 = await sdk.interop.status(created);
  console.log('STATUS after create:', st0);

  const finalizationInfo = await sdk.interop.wait(created, {
    pollMs: 5_000,
    timeoutMs: 30 * 60 * 1_000,
  });
  console.log('Bundle is finalized on source; root available on destination.');

  const finalizationResult = await sdk.interop.finalize(finalizationInfo);
  console.log('FINALIZE RESULT:', finalizationResult);

  const st1 = await sdk.interop.status(created);
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
