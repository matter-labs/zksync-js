import { describe, it } from 'bun:test';

// ANCHOR: imports
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../../../src/adapters/ethers';
import { ETH_ADDRESS } from '../../../../src/core';

const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
// ANCHOR_END: imports

describe('ethers deposit ETH guide', () => {

it('deposits some ETH', async () => {
  await main();
});

});

// ANCHOR: main
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

  const client = createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);

  const me = (await signer.getAddress()) as `0x${string}`;
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
  // ANCHOR: quote
  const quote = await sdk.deposits.quote(params);
  // ANCHOR_END: quote
  console.log('QUOTE response: ', quote);

  // ANCHOR: prepare
  const plan = await sdk.deposits.prepare(params);
  // ANCHOR_END: prepare
  console.log('PREPARE response: ', plan);

  // Create (prepare + send)
  // ANCHOR: create
  const handle = await sdk.deposits.create(params);
  // ANCHOR_END: create
  console.log('CREATE response: ', handle);

  // ANCHOR: status
    const status = await sdk.deposits.status(handle);  /* input can be handle or l1TxHash */
  // status.phase: 'UNKNOWN' | 'L1_PENDING' | 'L1_INCLUDED' | 'L2_PENDING' | 'L2_EXECUTED' | 'L2_FAILED'
  // ANCHOR_END: status
  console.log('STATUS response: ', status);

  // Wait (for now, L1 inclusion)
  const receipt = await sdk.deposits.wait(handle, { for: 'l1' });
  console.log(
    'Included at block:',
    receipt?.blockNumber,
    'status:',
    receipt?.status,
    'hash:',
    receipt?.hash,
  );

  const status2 = await sdk.deposits.status(handle);
  console.log('STATUS2 response: ', status2);

  // Wait (for now, L2 inclusion)
  const l2Receipt = await sdk.deposits.wait(handle, { for: 'l2' });
  console.log(
    'Included at block:',
    l2Receipt?.blockNumber,
    'status:',
    l2Receipt?.status,
    'hash:',
    l2Receipt?.hash,
  );
}
// ANCHOR_END: main