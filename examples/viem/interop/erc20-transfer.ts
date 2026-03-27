import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  type Account,
  type Chain,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, createViemSdk } from '../../../src/adapters/viem';
import type { Address, Hex } from '../../../src/core';
import { FORMAL_ETH_ADDRESS, L2_NATIVE_TOKEN_VAULT_ADDRESS } from '../../../src/core/constants';
import { IERC20ABI, L2NativeTokenVaultABI } from '../../../src/core/abi';
import { getErc20TokenAddress } from './utils';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const GW_RPC = process.env.GW_RPC ?? 'http://127.0.0.1:3052';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY in env');

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const me = account.address as Address;

  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2Source = createPublicClient({ transport: http(SRC_L2_RPC) });
  const l2Destination = createPublicClient({ transport: http(DST_L2_RPC) });

  const l1Wallet = createWalletClient<Transport, Chain, Account>({
    account,
    transport: http(L1_RPC),
  });

  const client = createViemClient({ l1, l2: l2Source, l1Wallet });
  const sdk = createViemSdk(client, { interop: { gwChain: GW_RPC } });

  console.log('Sender address:', me);

  // ---- Step 1: Deploy ERC20 token on L1 ----
  console.log('=== STEP 1: DEPLOY ERC20 ON L1 ===');
  const tokenL1Address = await getErc20TokenAddress({
    privateKey: PRIVATE_KEY as `0x${string}`,
    rpcUrl: L1_RPC,
  });
  console.log('Token deployed on L1 at:', tokenL1Address);

  const initialSupply = (await l1.readContract({
    address: tokenL1Address,
    abi: IERC20ABI,
    functionName: 'balanceOf',
    args: [me],
  })) as bigint;
  console.log('Initial supply on L1:', formatUnits(initialSupply, 18), 'TEST');

  // ---- Step 2: Deposit whole supply from L1 to source chain ----
  console.log('=== STEP 2: DEPOSIT WHOLE SUPPLY TO SOURCE CHAIN ===');

  const depositHandle = await sdk.deposits.create({
    token: tokenL1Address,
    amount: initialSupply,
    to: me,
  });

  console.log('Waiting for deposit to land on source chain...');
  await sdk.deposits.wait(depositHandle, { for: 'l2' });
  console.log('Deposit completed on source chain.');

  const tokenSrcAddress = (await sdk.tokens.toL2Address(tokenL1Address)) as Address;
  console.log('Token address on source chain:', tokenSrcAddress);

  const balanceOnSrc = (await l2Source.readContract({
    address: tokenSrcAddress,
    abi: IERC20ABI,
    functionName: 'balanceOf',
    args: [me],
  })) as bigint;
  console.log('Balance on source chain:', formatUnits(balanceOnSrc, 18), 'TEST');

  // ---- Step 3: Transfer via interop to destination chain ----
  console.log('=== STEP 3: INTEROP TRANSFER TO DESTINATION ===');

  const params = {
    actions: [
      {
        type: 'sendErc20' as const,
        token: tokenSrcAddress,
        to: me,
        amount: balanceOnSrc,
      },
    ],
    unbundling: { by: me },
  };

  // QUOTE: Build and return the summary.
  const quote = await sdk.interop.quote(l2Destination, params);
  console.log('INTEROP QUOTE:', quote);

  // PREPARE: Build plan without executing.
  const prepared = await sdk.interop.prepare(l2Destination, params);
  console.log('PREPARE:', prepared);

  // CREATE: Execute the source-chain step(s).
  const created = await sdk.interop.create(l2Destination, params);
  console.log('CREATE:', created);

  // WAIT: Wait for proof and interop root availability.
  const finalizationInfo = await sdk.interop.wait(l2Destination, created, {
    pollMs: 5_000,
    timeoutMs: 30 * 60 * 1_000,
  });
  console.log('Bundle finalized on source; root available on destination.');

  // FINALIZE: Execute on destination chain.
  const finalizationResult = await sdk.interop.finalize(l2Destination, finalizationInfo);
  console.log('FINALIZE RESULT:', finalizationResult);

  const assetId = (await sdk.tokens.assetIdOfL2(tokenSrcAddress)) as Hex;
  console.log('Asset ID:', assetId);

  const tokenDstAddress = (await l2Destination.readContract({
    address: L2_NATIVE_TOKEN_VAULT_ADDRESS,
    abi: L2NativeTokenVaultABI,
    functionName: 'tokenAddress',
    args: [assetId],
  })) as Address;

  if (tokenDstAddress === FORMAL_ETH_ADDRESS) {
    console.log('Token is not registered on destination yet.');
  } else {
    const balanceOnDst = (await l2Destination.readContract({
      address: tokenDstAddress,
      abi: IERC20ABI,
      functionName: 'balanceOf',
      args: [me],
    })) as bigint;
    console.log('Destination token address:', tokenDstAddress);
    console.log('Destination balance:', formatUnits(balanceOnDst, 18), 'TEST');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
