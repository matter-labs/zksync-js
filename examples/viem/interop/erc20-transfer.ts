import { createPublicClient, createWalletClient, formatUnits, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createViemClient, createViemSdk } from '../../../src/adapters/viem';
import type { Address, Hex } from '../../../src/core/types/primitives';
import { FORMAL_ETH_ADDRESS, L2_NATIVE_TOKEN_VAULT_ADDRESS } from '../../../src/core/constants';
import { IERC20ABI, L2NativeTokenVaultABI } from '../../../src/core/abi';
import { getErc20TokenAddress } from './utils';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const AMOUNT_RAW = process.env.AMOUNT ?? '100';

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY in env');

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

  const l1 = createPublicClient({ transport: http(L1_RPC) });
  const l2Source = createPublicClient({ transport: http(SRC_L2_RPC) });
  const l2Destination = createPublicClient({ transport: http(DST_L2_RPC) });

  const l1Wallet = createWalletClient({ account, transport: http(L1_RPC) });
  const l2Wallet = createWalletClient({ account, transport: http(SRC_L2_RPC) });

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
  const recipientOnDst = account.address as Address;
  const amountToSend = parseUnits(AMOUNT_RAW, 18);

  console.log('Source chain ID:', srcChainId);
  console.log('Destination chain ID:', dstChainId);
  console.log('Sender address:', me);

  // ---- Deploy ERC20 token on source chain ----
  console.log('=== DEPLOYING ERC20 TOKEN ===');
  const tokenAAddress = await getErc20TokenAddress({
    wallet: l2Wallet,
    publicClient: l2Source,
  });
  console.log('Token deployed at:', tokenAAddress);
  console.log('Token registration will be handled by the SDK');

  const balanceA = (await l2Source.readContract({
    address: tokenAAddress,
    abi: IERC20ABI,
    functionName: 'balanceOf',
    args: [me],
  })) as bigint;
  console.log('WalletA token balance:', formatUnits(balanceA, 18), 'TEST');

  const params = {
    sender: me,
    dstChainId: BigInt(dstChainId),
    actions: [
      {
        type: 'sendErc20' as const,
        token: tokenAAddress,
        to: recipientOnDst,
        amount: amountToSend,
      },
    ],
    unbundling: { by: recipientOnDst },
  };

  const quote = await sdk.interop.quote(params);
  console.log('QUOTE:', quote);

  const prepared = await sdk.interop.prepare(params);
  console.log('PREPARE:', prepared);

  const created = await sdk.interop.create(params);
  console.log('CREATE:', created);

  const finalizationInfo = await sdk.interop.wait(created, {
    pollMs: 5_000,
    timeoutMs: 30 * 60 * 1_000,
  });
  console.log('Bundle is finalized on source; root available on destination.');
  console.log('bundleHash', finalizationInfo.bundleHash);
  console.log('dstChainId', finalizationInfo.dstChainId.toString());

  const finalizationResult = await sdk.interop.finalize(finalizationInfo);
  console.log('FINALIZE RESULT:', finalizationResult);

  const assetId = (await sdk.tokens.assetIdOfL2(tokenAAddress)) as Hex;
  console.log('Asset ID:', assetId);

  const tokenBAddress = (await l2Destination.readContract({
    address: L2_NATIVE_TOKEN_VAULT_ADDRESS,
    abi: L2NativeTokenVaultABI,
    functionName: 'tokenAddress',
    args: [assetId],
  })) as Address;

  if (tokenBAddress.toLowerCase() === FORMAL_ETH_ADDRESS.toLowerCase()) {
    console.log('Token is not registered on destination yet.');
  } else {
    const balanceB = (await l2Destination.readContract({
      address: tokenBAddress,
      abi: IERC20ABI,
      functionName: 'balanceOf',
      args: [recipientOnDst],
    })) as bigint;
    console.log('Destination token address:', tokenBAddress);
    console.log('Destination balance:', balanceB.toString());
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
