import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Chain,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createViemClient, createViemSdk } from '../../../src/adapters/viem';
import type { Address } from '../../../src/core';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';

async function main() {
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  const token = process.env.TOKEN_SRC_ADDRESS as Address | undefined;
  if (!privateKey || !token) {
    throw new Error('Set PRIVATE_KEY and TOKEN_SRC_ADDRESS in env.');
  }

  const account = privateKeyToAccount(privateKey);
  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2Source = createPublicClient({ transport: http(SRC_L2_RPC) });
  const l2Destination = createPublicClient({ transport: http(DST_L2_RPC) });
  const l1Wallet = createWalletClient<Transport, Chain, Account>({
    account,
    transport: http(L1_RPC),
  });
  const l2Wallet = createWalletClient<Transport, Chain, Account>({
    account,
    transport: http(SRC_L2_RPC),
  });

  const sdk = createViemSdk(createViemClient({ l1, l2: l2Source, l1Wallet, l2Wallet }), {
    interop: { enableExperimentalAtomicSend: true },
  });
  const deadline = await sdk.interop.getSettlementDeadline({ afterSeconds: 3_600 });
  const params = {
    deadline,
    actions: [
      {
        type: 'sendErc20' as const,
        token,
        to: account.address,
        amount: 1_000_000n,
      },
    ],
  };

  console.log('QUOTE:', await sdk.interop.quote(l2Destination, params));

  await sdk.interop.approve(l2Destination, params);
  const draft = await sdk.interop.previewLeg(l2Destination, params);
  const flow = sdk.interop.defineFlow({
    legs: [draft.commitment],
    deadline,
    settlementLayerChainId: draft.settlementLayerChainId,
  });
  const intent = sdk.interop.bindFlow(draft, flow);

  console.log('PREPARE:', await sdk.interop.prepare(l2Destination, intent));
  const handle = await sdk.interop.create(l2Destination, intent);
  console.log('CREATE:', handle);
  console.log('STATUS:', await sdk.interop.status(l2Destination, handle));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
