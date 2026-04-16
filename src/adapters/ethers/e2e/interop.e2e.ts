/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { describe, it, expect, beforeAll } from 'bun:test';
import { AbiCoder, Contract, JsonRpcProvider, NonceManager, Wallet, parseEther } from 'ethers';
import { createEthersClient } from '../client.ts';
import { createEthersSdk } from '../sdk.ts';
import type { Address, Hex } from '../../../core/types/primitives.ts';
import { IERC20ABI, L2NativeTokenVaultABI } from '../../../core/abi.ts';
import { L2_NATIVE_TOKEN_VAULT_ADDRESS } from '../../../core/constants.ts';
import {
  getFundsReceiverAddress,
  getGreetingTokenAddress,
} from '../../../../examples/ethers/interop/utils.ts';

const L1_RPC = process.env.L1_RPC ?? 'http://127.0.0.1:8545';
const GW_RPC = process.env.GW_RPC ?? 'http://127.0.0.1:3052';
const SRC_L2_RPC = process.env.SRC_L2_RPC ?? 'http://127.0.0.1:3050';
const DST_L2_RPC = process.env.DST_L2_RPC ?? 'http://127.0.0.1:3051';
const PRIVATE_KEY =
  process.env.PRIVATE_KEY ?? '0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110';

const WAIT_OPTS = { pollMs: 5_000, timeoutMs: 30 * 60_000 };
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const NATIVE_AMOUNT = parseEther('0.001');
const ERC20_AMOUNT = 1_000_000n;

function makeInteropSetup() {
  const l1 = new JsonRpcProvider(L1_RPC);
  const l2Src = new JsonRpcProvider(SRC_L2_RPC);
  const l2Dst = new JsonRpcProvider(DST_L2_RPC);
  const signer = new NonceManager(new Wallet(PRIVATE_KEY, l2Src));
  const me = new Wallet(PRIVATE_KEY).address as Address;

  const client = createEthersClient({ l1, l2: l2Src, signer });
  const sdk = createEthersSdk(client, { interop: { gwChain: GW_RPC } });

  return { l1, l2Src, l2Dst, sdk, me };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: send-native — sends ETH cross-chain to a FundsReceiver contract
// ─────────────────────────────────────────────────────────────────────────────
describe('interop.e2e (ethers): send-native', () => {
  let sdk: any, l2Dst: JsonRpcProvider, me: Address;
  let fundsReceiver: Address;
  let receiverBalanceBefore: bigint;
  let handle: any;
  let finalizationInfo: any;

  beforeAll(async () => {
    ({ sdk, l2Dst, me } = makeInteropSetup());
    const dstSigner = new Wallet(PRIVATE_KEY, l2Dst);
    fundsReceiver = await getFundsReceiverAddress({ signer: dstSigner });
    receiverBalanceBefore = (await l2Dst.getBalance(fundsReceiver)) as bigint;
  }, 60_000);

  it('quote returns valid send-native summary', async () => {
    const q = await sdk.interop.quote(l2Dst, {
      actions: [{ type: 'sendNative', to: fundsReceiver, amount: NATIVE_AMOUNT }],
    });
    expect(q.route).toMatch('direct');
    expect(q.totalActionValue).toBe(NATIVE_AMOUNT);
    expect(q.bridgedTokenTotal).toBe(0n);
    expect(q.interopFee.amount).toBeGreaterThan(0n);
    expect(typeof q.interopFee.amount).toBe('bigint');
  }, 30_000);

  it('prepare returns a plan with steps', async () => {
    const plan = await sdk.interop.prepare(l2Dst, {
      actions: [{ type: 'sendNative', to: fundsReceiver, amount: NATIVE_AMOUNT }],
    });
    expect(plan.route).toMatch('direct');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0].key).toBe('sendBundle');
    expect(plan.steps[0].tx).toBeDefined();
  }, 30_000);

  it('create returns an interop handle and initial status is SENT', async () => {
    handle = await sdk.interop.create(l2Dst, {
      actions: [{ type: 'sendNative', to: fundsReceiver, amount: NATIVE_AMOUNT }],
    });
    expect(handle.kind).toBe('interop');
    expect(handle.l2SrcTxHash).toMatch(TX_HASH_RE);
    expect(handle.stepHashes.sendBundle).toMatch(TX_HASH_RE);

    const st = await sdk.interop.status(l2Dst, handle);
    expect(['SENT', 'VERIFIED', 'EXECUTED']).toContain(st.phase);
    expect(st.l2SrcTxHash).toMatch(TX_HASH_RE);
  }, 60_000);

  it('wait returns finalization info with bundle proof', async () => {
    finalizationInfo = await sdk.interop.wait(l2Dst, handle, WAIT_OPTS);
    expect(finalizationInfo.bundleHash).toMatch(TX_HASH_RE);
    expect(finalizationInfo.proof).toBeDefined();
    expect(finalizationInfo.encodedData).toBeDefined();
  }, 35 * 60_000);

  it('finalize executes bundle on destination and FundsReceiver balance increases', async () => {
    const result = await sdk.interop.finalize(l2Dst, finalizationInfo);
    expect(result.dstExecTxHash).toMatch(TX_HASH_RE);
    expect(result.bundleHash).toMatch(TX_HASH_RE);

    const st = await sdk.interop.status(l2Dst, handle);
    expect(st.phase).toBe('EXECUTED');

    const receiverBalanceAfter = (await l2Dst.getBalance(fundsReceiver)) as bigint;
    expect(receiverBalanceAfter - receiverBalanceBefore).toBe(NATIVE_AMOUNT);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: send-erc20 — transfers a bridged ERC-20 to destination chain
// ─────────────────────────────────────────────────────────────────────────────
describe('interop.e2e (ethers): send-erc20', () => {
  let sdk: any, l2Dst: JsonRpcProvider, me: Address;
  let tokenSrcAddress: Address;
  let handle: any;
  let finalizationInfo: any;

  beforeAll(() => {
    if (!process.env.TOKEN_SRC_ADDRESS) {
      throw new Error('TOKEN_SRC_ADDRESS env var is required for send-erc20 e2e test');
    }
    ({ sdk, l2Dst, me } = makeInteropSetup());
    tokenSrcAddress = process.env.TOKEN_SRC_ADDRESS as Address;
  }, 30_000);

  it('quote returns valid send-erc20 summary', async () => {
    const q = await sdk.interop.quote(l2Dst, {
      actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: ERC20_AMOUNT }],
    });
    expect(q.route).toMatch('indirect');
    expect(q.bridgedTokenTotal).toBe(ERC20_AMOUNT);
    expect(Array.isArray(q.approvalsNeeded)).toBe(true);
    expect(typeof q.interopFee.amount).toBe('bigint');
  }, 30_000);

  it('create returns an interop handle for ERC-20 transfer', async () => {
    handle = await sdk.interop.create(l2Dst, {
      actions: [{ type: 'sendErc20', token: tokenSrcAddress, to: me, amount: ERC20_AMOUNT }],
    });
    expect(handle.kind).toBe('interop');
    expect(handle.l2SrcTxHash).toMatch(TX_HASH_RE);
  }, 60_000);

  it('wait returns finalization info for ERC-20 bundle', async () => {
    finalizationInfo = await sdk.interop.wait(l2Dst, handle, WAIT_OPTS);
    expect(finalizationInfo.bundleHash).toMatch(TX_HASH_RE);
    expect(finalizationInfo.proof).toBeDefined();
  }, 35 * 60_000);

  it('finalize executes ERC-20 transfer and recipient receives tokens on destination', async () => {
    const result = await sdk.interop.finalize(l2Dst, finalizationInfo);
    expect(result.dstExecTxHash).toMatch(TX_HASH_RE);
    expect(result.bundleHash).toMatch(TX_HASH_RE);

    // Resolve destination token address via L2 Native Token Vault
    const assetId = (await sdk.tokens.assetIdOfL2(tokenSrcAddress)) as Hex;
    const ntvDst = new Contract(L2_NATIVE_TOKEN_VAULT_ADDRESS, L2NativeTokenVaultABI, l2Dst);
    const tokenDstAddress = (await ntvDst.tokenAddress(assetId)) as Address;
    expect(tokenDstAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const tokenOnDst = new Contract(tokenDstAddress, IERC20ABI, l2Dst);
    const balanceOnDst = (await tokenOnDst.balanceOf(me)) as bigint;
    expect(balanceOnDst).toBeGreaterThanOrEqual(ERC20_AMOUNT);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: remote-call — calls a contract on destination chain via interop
// ─────────────────────────────────────────────────────────────────────────────
describe('interop.e2e (ethers): remote-call', () => {
  let sdk: any, l2Dst: JsonRpcProvider;
  let greeterAddress: Address;
  let handle: any;
  let finalizationInfo: any;
  const GREETING_ABI = ['function message() view returns (string)'] as const;
  const newGreeting = 'hello from ethers e2e test!';

  beforeAll(async () => {
    ({ sdk, l2Dst } = makeInteropSetup());
    const dstSigner = new Wallet(PRIVATE_KEY, l2Dst);
    greeterAddress = await getGreetingTokenAddress({ signer: dstSigner });
  }, 60_000);

  it('create sends a remote call bundle to destination', async () => {
    const calldata = AbiCoder.defaultAbiCoder().encode(['string'], [newGreeting]) as Hex;
    handle = await sdk.interop.create(l2Dst, {
      actions: [{ type: 'call' as const, to: greeterAddress, data: calldata }],
    });
    expect(handle.kind).toBe('interop');
    expect(handle.l2SrcTxHash).toMatch(TX_HASH_RE);

    const st = await sdk.interop.status(l2Dst, handle);
    expect(['SENT', 'VERIFIED', 'EXECUTED']).toContain(st.phase);
  }, 60_000);

  it('wait returns finalization info for call bundle', async () => {
    finalizationInfo = await sdk.interop.wait(l2Dst, handle, WAIT_OPTS);
    expect(finalizationInfo.bundleHash).toMatch(TX_HASH_RE);
    expect(finalizationInfo.proof).toBeDefined();
  }, 35 * 60_000);

  it('finalize executes call and Greeter message is updated on destination', async () => {
    const result = await sdk.interop.finalize(l2Dst, finalizationInfo);
    expect(result.dstExecTxHash).toMatch(TX_HASH_RE);
    expect(result.bundleHash).toMatch(TX_HASH_RE);

    const greeter = new Contract(greeterAddress, GREETING_ABI, l2Dst);
    const messageAfter = (await greeter.message()) as string;
    expect(messageAfter).toBe(newGreeting);
  }, 60_000);
});
