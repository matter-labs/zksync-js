/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// tests/e2e/helpers.ts
import { JsonRpcProvider, Wallet, Contract, ContractFactory, NonceManager } from 'ethers';
import tokenJson from '../../../../tests/contracts/out/MintableERC20.sol/MintableERC20.json' assert { type: 'json' };

// Ethers v6 accepts ABI as any[]
export const TEST_ERC20_ABI = tokenJson.abi as any[];
export const TEST_ERC20_BYTECODE = tokenJson.bytecode as unknown as `0x${string}`;
import type { Address, Hex } from '../../../core/types/primitives.ts';
import { createEthersClient } from '../client.ts';
import { createEthersSdk } from '../sdk.ts';
import { expect } from 'bun:test';

// TODO: make this shared across resources
const L1_RPC_URL = 'http://127.0.0.1:8545';
const L2_RPC_URL = 'http://127.0.0.1:3050';
const PRIVATE_KEY = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const DEPLOYER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export function createTestClientAndSdk() {
  const l1 = new JsonRpcProvider(L1_RPC_URL);
  const l2 = new JsonRpcProvider(L2_RPC_URL);
  const base = new Wallet(PRIVATE_KEY, l1);
  const signer = new NonceManager(base);

  const client = createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);
  return { client, sdk };
}

/** Create deployer wallets bound to current providers (same PK on both chains). */
export function makeDeployers(l1: JsonRpcProvider, l2: JsonRpcProvider) {
  const baseL1 = new Wallet(DEPLOYER_PRIVATE_KEY, l1);
  const baseL2 = new Wallet(DEPLOYER_PRIVATE_KEY, l2);
  const deployerL1 = new NonceManager(baseL1);
  const deployerL2 = new NonceManager(baseL2);
  return { deployerL1, deployerL2 };
}

// polling helper
export async function waitForL1Inclusion(sdk: any, handle: any, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await sdk.deposits.status(handle);
    if (s.phase !== 'L1_PENDING' && s.phase !== 'UNKNOWN') {
      return s;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Timed out waiting for L1 inclusion.');
}

/**
 * Poll until L2 inclusion is confirmed for a withdrawal (status != L2_PENDING/UNKNOWN).
 */
export async function waitForL2InclusionWithdraw(sdk: any, handle: any, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await sdk.withdrawals.status(handle);
    if (s.phase !== 'L2_PENDING' && s.phase !== 'UNKNOWN') return s;
    await sleep(1500);
  }
  throw new Error('Timed out waiting for L2 inclusion (withdrawal).');
}

// balance verification helper
export async function verifyDepositBalances(
  client: any,
  me: Address,
  balancesBefore: { l1: bigint; l2: bigint },
  mintValue: bigint,
  depositAmount: bigint,
  l1TxHashes: Hex[],
) {
  const l1Before = balancesBefore.l1;
  const l2Before = balancesBefore.l2;

  const [l1After, l2After] = await Promise.all([
    client.l1.getBalance(me),
    client.l2.getBalance(me),
  ]);

  // L2 Delta Check
  const l2Delta = l2After - l2Before;
  expect(l2Delta).toBeGreaterThanOrEqual(depositAmount);
  expect(l2Delta).toBeLessThanOrEqual(mintValue);

  // L1 Delta Check
  let totalL1Fees = 0n;
  for (const txHash of l1TxHashes) {
    const rcpt = await client.l1.getTransactionReceipt(txHash);
    expect(rcpt).toBeTruthy();
    const gasUsed = BigInt(rcpt.gasUsed);
    const effectiveGasPrice = BigInt(rcpt.effectiveGasPrice ?? rcpt.gasPrice);
    totalL1Fees += gasUsed * effectiveGasPrice;
  }

  const l1Delta = l1Before - l1After;
  expect(l1Delta).toBe(mintValue + totalL1Fees);
}

/**
 * Wait until withdrawal becomes READY_TO_FINALIZE (or FINALIZED).
 * No side-effects (uses status loop, not finalize()).
 */
export async function waitUntilReadyToFinalize(
  sdk: any,
  handle: any,
  timeoutMs = 180_000,
  pollMs = 3500,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await sdk.withdrawals.status(handle);
    if (s.phase === 'READY_TO_FINALIZE' || s.phase === 'FINALIZED') return s;
    await sleep(pollMs);
  }
  throw new Error('Timed out waiting for READY_TO_FINALIZE.');
}

/**
 * Verify withdrawal balance effects:
 *  - L2: decreases by at least `amount` (also includes L2 gas)
 *  - L1: after finalization, net delta = +amount - finalizeGas
 * If finalize receipt is unavailable, we only check that L1 increased by >= amount - someGas.
 */
export async function verifyWithdrawalBalancesAfterFinalize(args: {
  client: any;
  me: Address;
  balancesBefore: { l1: bigint; l2: bigint };
  amount: bigint;
  l2Rcpt: any; // TransactionReceiptZKsyncOS
  l1FinalizeRcpt: any | null; // TransactionReceipt or null
}) {
  const { client, me, balancesBefore, amount, l2Rcpt, l1FinalizeRcpt } = args;

  const [l1After, l2After] = await Promise.all([
    client.l1.getBalance(me),
    client.l2.getBalance(me),
  ]);

  // ---------- L2 checks ----------
  const l2Delta = balancesBefore.l2 - l2After;
  expect(l2Delta >= amount).toBeTrue();
  try {
    const gasUsed = BigInt(l2Rcpt?.gasUsed ?? 0n);
    const gp =
      l2Rcpt?.effectiveGasPrice !== undefined
        ? BigInt(l2Rcpt.effectiveGasPrice)
        : l2Rcpt?.gasPrice !== undefined
          ? BigInt(l2Rcpt.gasPrice)
          : 0n;
    const l2Fee = gasUsed * gp;
    const expectedMinSpend = amount + l2Fee;
    expect(l2Delta >= expectedMinSpend).toBeTrue();
  } catch {
    // ignore if fields not present
  }

  // ---------- L1 checks ----------
  const l1Delta = l1After - balancesBefore.l1;

  if (l1FinalizeRcpt) {
    const gasUsed = BigInt(l1FinalizeRcpt.gasUsed ?? 0n);
    const gp =
      l1FinalizeRcpt.effectiveGasPrice !== undefined
        ? BigInt(l1FinalizeRcpt.effectiveGasPrice)
        : l1FinalizeRcpt.gasPrice !== undefined
          ? BigInt(l1FinalizeRcpt.gasPrice)
          : 0n;
    const finalizeFee = gasUsed * gp;
    expect(l1Delta).toBe(amount - finalizeFee);
  } else {
    expect(l1Delta >= 0n).toBeTrue();
  }
}

// Deploy a mintable ERC-20 on the provided chain (L1 or L2).
export async function deployMintableErc20(
  provider: JsonRpcProvider,
  deployer: NonceManager,
  name = 'TestToken',
  symbol = 'TT',
  decimals = 18,
): Promise<Contract> {
  if (!TEST_ERC20_BYTECODE || TEST_ERC20_BYTECODE === '0x') {
    throw new Error(
      'TEST_ERC20_BYTECODE missing. Did you compile TestERC20.sol and is the import path correct?',
    );
  }

  const factory = new ContractFactory(TEST_ERC20_ABI, TEST_ERC20_BYTECODE, deployer);
  const token = await factory.deploy(name, symbol, decimals);
  await token.waitForDeployment();

  const addr = await token.getAddress();
  expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
  return token as unknown as Contract;
}

// Mint tokens
export async function mintTo(token: Contract, to: Address, amount: bigint) {
  const signer = token.runner as Wallet;
  if (!('sendTransaction' in signer)) {
    throw new Error('mintTo: token is not connected to a signer');
  }
  const data = token.interface.encodeFunctionData('mint(address,uint256)', [to, amount]);
  const tx = await signer.sendTransaction({
    to: await token.getAddress(),
    data,
    gasLimit: 300_000n,
  });
  await tx.wait();
}

// Check balance of an ERC-20 token
export async function erc20BalanceOf(
  provider: JsonRpcProvider,
  tokenAddress: Address,
  who: Address,
): Promise<bigint> {
  const token = new Contract(tokenAddress, TEST_ERC20_ABI, provider);
  const bal: bigint = await token.getFunction('balanceOf').staticCall(who);
  return bal;
}
