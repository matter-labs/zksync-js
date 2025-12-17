/**
 * Example: Deposit an ERC-20 token to an L2 where the base token ≠ this ERC-20
 *
 * Flow:
 * 1. Connect to L1 + L2 RPCs and create an SDK client (Ethers or Viem).
 * 2. Call `sdk.deposits.quote` to estimate gas/cost.
 * 3. Call `sdk.deposits.prepare` to build the tx plan (approvals + bridge call).
 * 4. Call `sdk.deposits.create` to send the approval(s) and the bridge tx.
 * 5. Track status with `sdk.deposits.status` and `sdk.deposits.wait`
 *    (`{ for: 'l1' }` waits for L1 inclusion, `{ for: 'l2' }` waits for L2 exec).
 *
 * Use this when:
 * - You’re depositing a standard ERC-20 token.
 * - The target L2’s base token is something else (e.g. you’re sending USDC to an ETH-based chain).
 */

import { JsonRpcProvider, Wallet, parseUnits } from 'ethers';

import { createEthersClient } from '../../../src/adapters/ethers/client';
import { createEthersSdk } from '../../../src/adapters/ethers/sdk';
import type { Address } from '../../../src/core/types/primitives';
import { IERC20ABI } from '../../../src/core/abi';

const L1_RPC = process.env.L1_RPC_URL ?? 'http://localhost:8545';
const L2_RPC = process.env.L2_RPC_URL ?? 'http://localhost:3050';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';

async function main() {
  if (!PRIVATE_KEY || !PRIVATE_KEY.startsWith('0x') || PRIVATE_KEY.length !== 66) {
    throw new Error('Set a 0x-prefixed 32-byte PRIVATE_KEY in .env');
  }

  // Pick an ERC-20 on L1 (example uses a dev/mocked token)
  // Make sure you hold some of this token on L1 before running!
  // Example: sepolia test token (TEST)
  // https://sepolia.etherscan.io/token/0x42E331a2613Fd3a5bc18b47AE3F01e1537fD8873
  const TOKEN = (process.env.DEPOSIT_TOKEN ??
    '0x42E331a2613Fd3a5bc18b47AE3F01e1537fD8873') as Address;

  // RPC + signer
  const l1 = new JsonRpcProvider(L1_RPC);
  const l2 = new JsonRpcProvider(L2_RPC);
  const signer = new Wallet(PRIVATE_KEY, l1);
  const me = (await signer.getAddress()) as Address;

  // Init SDK
  const client = createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);

  // Read token decimals from L1
  const erc20 = new (await import('ethers')).Contract(TOKEN, IERC20ABI, l1);
  const decimals = Number(await erc20.decimals());
  const amount = parseUnits('2', decimals); // deposit 2 tokens

  // QUOTE → no sends
  const quote = await sdk.deposits.quote({ token: TOKEN, to: me, amount });
  console.log('QUOTE →', quote);

  // PREPARE → route + steps only
  const plan = await sdk.deposits.prepare({ token: TOKEN, to: me, amount });
  console.log('PREPARE →', plan);

  // CREATE → sends approval(s) if needed + bridge step
  const handle = await sdk.deposits.create({ token: TOKEN, to: me, amount });
  console.log('CREATE →', handle);

  // STATUS (quick)
  console.log('STATUS →', await sdk.deposits.status(handle));

  // WAIT L1 inclusion
  console.log('⏳ Waiting for L1 inclusion…');
  const l1Receipt = await sdk.deposits.wait(handle, { for: 'l1' });
  console.log('✅ L1 included at block:', l1Receipt?.blockNumber);

  // WAIT L2 execution
  console.log('⏳ Waiting for L2 execution…');
  const l2Receipt = await sdk.deposits.wait(handle, { for: 'l2' });
  console.log('✅ L2 executed at block:', l2Receipt?.blockNumber);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
