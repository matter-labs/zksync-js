import { Contract, JsonRpcProvider, Wallet, parseUnits, formatUnits } from 'ethers';
import { createEthersClient, createEthersSdk } from '../../../src/adapters/ethers';
import { type Address, type Hex } from '../../../src/core';
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

  const l1 = new JsonRpcProvider(L1_RPC);
  const l2Source = new JsonRpcProvider(SRC_L2_RPC);
  const l2Destination = new JsonRpcProvider(DST_L2_RPC);

  const [srcNet, dstNet] = await Promise.all([l2Source.getNetwork(), l2Destination.getNetwork()]);

  const client = await createEthersClient({
    l1,
    l2: l2Source,
    signer: new Wallet(PRIVATE_KEY),
    chains: {
      [srcNet.chainId.toString()]: l2Source,
      [dstNet.chainId.toString()]: l2Destination,
    },
  });
  const sdk = createEthersSdk(client);

  const walletA = new Wallet(PRIVATE_KEY, l2Source);
  const walletB = new Wallet(PRIVATE_KEY, l2Destination);
  const me = (await walletA.getAddress()) as Address;
  const recipientOnDst = walletB.address as Address;

  const amountToSend = parseUnits(AMOUNT_RAW, 18);

  console.log('Source chain ID:', srcNet.chainId);
  console.log('Destination chain ID:', dstNet.chainId);
  console.log('Sender address:', me);

  // ---- Deploy ERC20 token on source chain ----
  console.log('=== DEPLOYING ERC20 TOKEN ===');
  const tokenAAddress = await getErc20TokenAddress({ signer: walletA });
  console.log('Token deployed at:', tokenAAddress);
  console.log('Token registration will be handled by the SDK');

  const tokenA = new Contract(tokenAAddress, IERC20ABI, l2Source);
  const balanceA = await tokenA.balanceOf(walletA.address);
  console.log('WalletA token balance:', formatUnits(balanceA, 18), 'TEST');

  const params = {
    dstChainId: dstNet.chainId,
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

  // QUOTE: Build and return the summary.
  const quote = await sdk.interop.quote(params);
  console.log('QUOTE:', quote);

  // PREPARE: Build plan without executing.
  const prepared = await sdk.interop.prepare(params);
  console.log('PREPARE:', prepared);

  // CREATE: Execute the source-chain step(s), wait for each tx receipt to confirm (status != 0).
  const created = await sdk.interop.create(params);
  console.log('CREATE:', created);

  // WAIT: Waits until the L2->L1 proof is available on source and the interop root
  // becomes available on the destination chain. It returns the proof payload needed
  // to execute the bundle later.
  const finalizationInfo = await sdk.interop.wait(created, {
    pollMs: 5_000,
    timeoutMs: 30 * 60 * 1_000,
  });
  console.log('Bundle is finalized on source; root available on destination.');

  // FINALIZE: Execute on destination and block until done.
  // finalize() calls executeBundle(...) on the destination chain,
  // waits for the tx to mine, then returns { bundleHash, dstChainId, dstExecTxHash }.
  const finalizationResult = await sdk.interop.finalize(finalizationInfo);
  console.log('FINALIZE RESULT:', finalizationResult);

  const assetId = (await sdk.tokens.assetIdOfL2(tokenAAddress)) as Hex;
  console.log('Asset ID:', assetId);

  const ntvDst = new Contract(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NativeTokenVaultABI, l2Destination);
  const tokenBAddress = (await ntvDst.tokenAddress(assetId)) as Address;

  if (tokenBAddress === FORMAL_ETH_ADDRESS) {
    console.log('Token is not registered on destination yet.');
  } else {
    const tokenB = new Contract(tokenBAddress, IERC20ABI, l2Destination);
    const balanceB = await tokenB.balanceOf(recipientOnDst);
    console.log('Destination token address:', tokenBAddress);
    console.log('Destination balance:', balanceB.toString());
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
