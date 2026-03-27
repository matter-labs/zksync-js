import { Contract, JsonRpcProvider, Wallet, formatUnits } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../../src/adapters/ethers';
import { type Address, type Hex } from '../../../src/core';
import { L2_NATIVE_TOKEN_VAULT_ADDRESS } from '../../../src/core/constants';
import { IERC20ABI, L2NativeTokenVaultABI } from '../../../src/core/abi';
import { getErc20TokenAddress } from './utils';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const GW_RPC = process.env.GW_RPC ?? 'http://127.0.0.1:3052';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY in env');

  const l1 = new JsonRpcProvider(L1_RPC);
  const l2Source = new JsonRpcProvider(SRC_L2_RPC);
  const l2Destination = new JsonRpcProvider(DST_L2_RPC);

  const walletOnL1 = new Wallet(PRIVATE_KEY, l1);
  const walletOnDst = new Wallet(PRIVATE_KEY, l2Destination);
  const me = (await walletOnL1.getAddress()) as Address;
  const recipientOnDst = walletOnDst.address as Address;

  const client = createEthersClient({
    l1,
    l2: l2Source,
    signer: new Wallet(PRIVATE_KEY),
  });
  const sdk = createEthersSdk(client, {
    interop: { gwChain: GW_RPC },
  });

  console.log('Sender address:', me);

  // ---- Step 1: Deploy ERC20 token on L1 ----
  console.log('=== STEP 1: DEPLOY ERC20 ON L1 ===');
  const tokenL1Address = await getErc20TokenAddress({ signer: walletOnL1 });
  console.log('Token deployed on L1 at:', tokenL1Address);

  const tokenOnL1 = new Contract(tokenL1Address, IERC20ABI, l1);
  const initialSupply = await tokenOnL1.balanceOf(me);
  console.log('Initial supply on L1:', formatUnits(initialSupply, 18), 'TEST');

  // ---- Step 2: Deposit whole supply from L1 to source chain ----
  console.log('=== STEP 2: DEPOSIT WHOLE SUPPLY TO SOURCE CHAIN ===');

  // Deposit the full supply from L1 to Chain A. This routes through
  // handleChainBalanceIncreaseOnGateway on the gateway, populating
  // GWAssetTracker.chainBalance[chainA][assetId].
  const depositHandle = await sdk.deposits.create({
    token: tokenL1Address,
    amount: initialSupply,
    to: me,
  });

  console.log('Waiting for deposit to land on source chain...');
  await sdk.deposits.wait(depositHandle, { for: 'l2' });
  console.log('Deposit completed on source chain.');

  // Resolve the bridged token address on the source chain.
  const tokenSrcAddress = (await sdk.tokens.toL2Address(tokenL1Address)) as Address;
  console.log('Token address on source chain:', tokenSrcAddress);

  const tokenOnSrc = new Contract(tokenSrcAddress, IERC20ABI, l2Source);
  const balanceOnSrc = await tokenOnSrc.balanceOf(me);
  console.log('Balance on source chain:', formatUnits(balanceOnSrc, 18), 'TEST');

  // ---- Step 3: Transfer via interop to destination chain ----
  console.log('=== STEP 3: INTEROP TRANSFER TO DESTINATION ===');

  const params = {
    actions: [
      {
        type: 'sendErc20' as const,
        token: tokenSrcAddress,
        to: recipientOnDst,
        amount: balanceOnSrc,
      },
    ],
    unbundling: { by: recipientOnDst },
  };

  // QUOTE: Build and return the summary.
  const quote = await sdk.interop.quote(l2Destination, params);
  console.log('INTEROP QUOTE:', quote);

  // PREPARE: Build plan without executing.
  const prepared = await sdk.interop.prepare(l2Destination, params);
  console.log('PREPARE:', prepared);

  // CREATE: Execute the source-chain step(s), wait for each tx receipt to confirm (status != 0).
  const created = await sdk.interop.create(l2Destination, params);
  console.log('CREATE:', created);

  // WAIT: Waits until the L2->L1 proof is available on source and the interop root
  // becomes available on the destination chain. It returns the proof payload needed
  // to execute the bundle later.
  const finalizationInfo = await sdk.interop.wait(l2Destination, created, {
    pollMs: 5_000,
    timeoutMs: 30 * 60 * 1_000,
  });
  console.log('Bundle is finalized on source; root available on destination.');

  // FINALIZE: Execute on destination and block until done.
  // finalize() calls executeBundle(...) on the destination chain,
  // waits for the tx to mine, then returns { bundleHash, dstExecTxHash }.
  const finalizationResult = await sdk.interop.finalize(l2Destination, finalizationInfo);
  console.log('FINALIZE RESULT:', finalizationResult);

  const assetId = (await sdk.tokens.assetIdOfL2(tokenSrcAddress)) as Hex;
  console.log('Asset ID:', assetId);

  const ntvDst = new Contract(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NativeTokenVaultABI, l2Destination);
  const tokenDstAddress = (await ntvDst.tokenAddress(assetId)) as Address;

  const tokenOnDst = new Contract(tokenDstAddress, IERC20ABI, l2Destination);
  const balanceOnDst = await tokenOnDst.balanceOf(recipientOnDst);
  console.log('Destination token address:', tokenDstAddress);
  console.log('Destination balance:', formatUnits(balanceOnDst, 18), 'TEST');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
