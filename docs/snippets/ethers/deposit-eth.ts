// examples/deposit-eth.ts
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '@matter-labs/zksync-js/ethers';
import { ETH_ADDRESS } from '@matter-labs/zksync-js/core';

const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error('Set your PRIVATE_KEY in the .env file');
  }
  const l1 = new JsonRpcProvider(L1_RPC);
  const l2 = new JsonRpcProvider(L2_RPC);
  const signer = new Wallet(PRIVATE_KEY, l1);

  const balance = await l1.getBalance(signer.address);
  console.log('L1 balance:', balance.toString());

  const balanceL2 = await l2.getBalance(signer.address);
  console.log('L2 balance:', balanceL2.toString());

  const client = await createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);

  const me = (await signer.getAddress());
  const params = {
    amount: parseEther('.01'), // 0.01 ETH
    to: me,
    token: ETH_ADDRESS,
    // optional:
    // l2GasLimit: 300_000n,
    // gasPerPubdata: 800n,
    // operatorTip: 0n,
    // refundRecipient: me,
  } as const;

  // Quote
  const quote = await sdk.deposits.quote(params);
  console.log('QUOTE response: ', quote);

  const prepare = await sdk.deposits.prepare(params);
  console.log('PREPARE response: ', prepare);

  // Create (prepare + send)
  const create = await sdk.deposits.create(params);
  console.log('CREATE response: ', create);

  const status = await sdk.deposits.status(create);
  console.log('STATUS response: ', status);

  // Wait (for now, L1 inclusion)
  const receipt = await sdk.deposits.wait(create, { for: 'l1' });
  console.log(
    'Included at block:',
    receipt?.blockNumber,
    'status:',
    receipt?.status,
    'hash:',
    receipt?.hash,
  );

  const status2 = await sdk.deposits.status(create);
  console.log('STATUS2 response: ', status2);

  // Wait (for now, L2 inclusion)
  const l2Receipt = await sdk.deposits.wait(create, { for: 'l2' });
  console.log(
    'Included at block:',
    l2Receipt?.blockNumber,
    'status:',
    l2Receipt?.status,
    'hash:',
    l2Receipt?.hash,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
