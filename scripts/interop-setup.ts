#!/usr/bin/env bun
/**
 * Interop test setup script.
 *
 * Prepares the environment for running interop docs-snippet tests:
 *   1. Deposits ETH from L1 to L2 src (funds the test wallet).
 *   2. Deposits ETH from L1 to L2 dst (funds the test wallet).
 *   3. Deploys a SimpleERC20 token on L1.
 *   4. Deposits the full token supply from L1 to L2 src.
 *   5. Deploys a Greeting contract on L2 dst (for e2e-call tests).
 *
 * Writes KEY=VALUE pairs to stdout, suitable for piping into $GITHUB_ENV:
 *
 *   bun run scripts/interop-setup.ts >> "$GITHUB_ENV"
 *
 * Exported variables:
 *   TOKEN_SRC_ADDRESS    – bridged ERC-20 address on L2 src
 *   GREETER_DST_ADDRESS  – Greeting contract address on L2 dst
 *
 * Required env:
 *   PRIVATE_KEY      – test wallet private key
 *
 * Optional env (defaults match the standard local multi-chain setup):
 *   L1_RPC           – http://127.0.0.1:8545
 *   GW_RPC           – http://127.0.0.1:3052
 *   SRC_L2_RPC       – http://127.0.0.1:3050
 *   DST_L2_RPC       – http://127.0.0.1:3051
 */

import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { createEthersClient, createEthersSdk } from '../src/adapters/ethers';
import type { Address } from '../src/core';
import { ETH_ADDRESS } from '../src/core';
import { IERC20ABI } from '../src/core/abi';
import { getErc20TokenAddress, getGreetingTokenAddress } from '../examples/ethers/interop/utils';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const GW_RPC = process.env.GW_RPC ?? 'http://127.0.0.1:3052';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';

const FUND_AMOUNT = 1_000_000_000_000_000_000n; // 1 ETH

function log(msg: string) {
  process.stderr.write(msg + '\n');
}

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY env var is required');

  const l1 = new JsonRpcProvider(L1_RPC);
  const l2Src = new JsonRpcProvider(SRC_L2_RPC);
  const l2Dst = new JsonRpcProvider(DST_L2_RPC);

  const walletL1 = new Wallet(PRIVATE_KEY, l1);
  const walletDst = new Wallet(PRIVATE_KEY, l2Dst);
  const me = walletL1.address as Address;
  log(`Wallet: ${me}`);

  const sdkSrc = createEthersSdk(
    createEthersClient({ l1, l2: l2Src, signer: new Wallet(PRIVATE_KEY, l1) }),
    { interop: { gwChain: GW_RPC } },
  );

  const sdkDst = createEthersSdk(
    createEthersClient({ l1, l2: l2Dst, signer: new Wallet(PRIVATE_KEY, l1) }),
    { interop: { gwChain: GW_RPC } },
  );

  // 1. Deposit ETH from L1 to L2 src.
  log('Depositing ETH to L2 src…');
  const ethSrcHandle = await sdkSrc.deposits.create({
    token: ETH_ADDRESS,
    amount: FUND_AMOUNT,
    to: me,
  });
  await sdkSrc.deposits.wait(ethSrcHandle, { for: 'l2' });
  log(`L2 src: deposited ${FUND_AMOUNT} wei ETH`);

  // 2. Deposit ETH from L1 to L2 dst.
  log('Depositing ETH to L2 dst…');
  const ethDstHandle = await sdkDst.deposits.create({
    token: ETH_ADDRESS,
    amount: FUND_AMOUNT,
    to: me,
  });
  await sdkDst.deposits.wait(ethDstHandle, { for: 'l2' });
  log(`L2 dst: deposited ${FUND_AMOUNT} wei ETH`);

  // 3. Deploy SimpleERC20 on L1.
  log('Deploying ERC-20 on L1…');
  const tokenL1Address = await getErc20TokenAddress({ signer: walletL1 });
  log(`Token on L1: ${tokenL1Address}`);

  const tokenOnL1 = new Contract(tokenL1Address, IERC20ABI, l1);
  const initialSupply = (await tokenOnL1.balanceOf(me)) as bigint;
  log(`Initial supply: ${initialSupply}`);

  // 4. Deposit ERC-20 from L1 to L2 src.
  log('Depositing ERC-20 to L2 src…');
  const erc20Handle = await sdkSrc.deposits.create({
    token: tokenL1Address,
    amount: initialSupply,
    to: me,
  });
  await sdkSrc.deposits.wait(erc20Handle, { for: 'l2' });
  log('ERC-20 deposit complete.');

  // 5. Resolve the bridged token address on L2 src.
  const tokenSrcAddress = (await sdkSrc.tokens.toL2Address(tokenL1Address)) as Address;
  log(`Token on L2 src: ${tokenSrcAddress}`);

  // 6. Deploy Greeting contract on L2 dst (used by e2e-call reference tests).
  log('Deploying Greeting contract on L2 dst…');
  const greeterDstAddress = await getGreetingTokenAddress({ signer: walletDst });
  log(`Greeting contract on L2 dst: ${greeterDstAddress}`);

  // Output KEY=VALUE pairs for direct use with $GITHUB_ENV or eval.
  process.stdout.write(`TOKEN_SRC_ADDRESS=${tokenSrcAddress}\n`);
  process.stdout.write(`GREETER_DST_ADDRESS=${greeterDstAddress}\n`);
}

main().catch((err: unknown) => {
  log(`Setup failed: ${String(err)}`);
  process.exit(1);
});
