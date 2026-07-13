import { JsonRpcProvider, Wallet } from 'ethers';

import { createEthersClient, createEthersSdk } from '../../../src/adapters/ethers';
import type { Address } from '../../../src/core';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  const token = process.env.TOKEN_SRC_ADDRESS as Address | undefined;
  if (!privateKey || !token) {
    throw new Error('Set PRIVATE_KEY and TOKEN_SRC_ADDRESS in env.');
  }

  const l1 = new JsonRpcProvider(L1_RPC);
  const l2Source = new JsonRpcProvider(SRC_L2_RPC);
  const l2Destination = new JsonRpcProvider(DST_L2_RPC);
  const signer = new Wallet(privateKey);
  const recipient = signer.address as Address;

  const sdk = createEthersSdk(createEthersClient({ l1, l2: l2Source, signer }), {
    interop: { enableExperimentalAtomicSend: true },
  });
  const deadline = await sdk.interop.getSettlementDeadline({ afterSeconds: 3_600 });
  const params = {
    deadline,
    actions: [
      {
        type: 'sendErc20' as const,
        token,
        to: recipient,
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
