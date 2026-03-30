/**
 * Docs test preload — runs once before all docs snippet tests.
 *
 * Tops up the test wallet on L2 via sdk.deposits so that withdrawal
 * and other docs tests have sufficient balance.
 */
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../src/adapters/ethers';
import { ETH_ADDRESS } from '../../src/core';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const L2_RPC = process.env.L2_RPC ?? 'http://127.0.0.1:3050';
const PRIVATE_KEY = process.env.PRIVATE_KEY!;

const TOP_UP_AMOUNT = parseEther('1.0');

const l1 = new JsonRpcProvider(L1_RPC);
const l2 = new JsonRpcProvider(L2_RPC);
const signer = new Wallet(PRIVATE_KEY, l1);
const address = await signer.getAddress();

const client = createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);

console.log(`[docs setup] Depositing ${TOP_UP_AMOUNT} wei to ${address} on L2...`);

const handle = await sdk.deposits.create({
  token: ETH_ADDRESS,
  amount: TOP_UP_AMOUNT,
  to: address as `0x${string}`,
});

await sdk.deposits.wait(handle, { for: 'l2' });
console.log('[docs setup] Deposit complete.');
