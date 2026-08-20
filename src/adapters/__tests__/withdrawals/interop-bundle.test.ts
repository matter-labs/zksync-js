import { it, expect } from 'bun:test';
import { AbiCoder, Interface, keccak256 } from 'ethers';

import { routeInteropBundle as routeEthers } from '../../ethers/resources/withdrawals/routes/interop-bundle.ts';
import { routeInteropBundle as routeViem } from '../../viem/resources/withdrawals/routes/interop-bundle.ts';
import {
  ADAPTER_TEST_ADDRESSES,
  makeWithdrawalContext,
  setErc20Allowance,
  setL2TokenRegistration,
  describeForAdapters,
} from '../adapter-harness.ts';
import {
  IInteropCenterABI,
  IERC7786AttributesABI,
  L2NativeTokenVaultABI,
} from '../../../core/abi.ts';
import {
  FORMAL_ETH_ADDRESS,
  L2_ASSET_ROUTER_ADDRESS,
  L2_INTEROP_CENTER_ADDRESS,
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
} from '../../../core/constants.ts';
import type { Address, Hex } from '../../../core/types/primitives';

const ROUTES = {
  ethers: routeEthers(),
  viem: routeViem(),
} as const;

const IInteropCenter = new Interface(IInteropCenterABI as never);
const IAttributes = new Interface(IERC7786AttributesABI as never);

const TOKEN = '0x2222222222222222222222222222222222222222' as Address;
const ASSET_ID = `0x${'aa'.repeat(32)}` as Hex;
const L1_CHAIN_ID = 1n;
const AMOUNT = 1_500n;
// Matches the harness' mocked pending nonce.
const NONCE = 7n;

type DecodedSend = {
  destinationChain: Hex;
  starters: Array<[Hex, Hex, Hex[]]>;
  bundleAttributes: Hex[];
  value: bigint;
};

/** Normalize the final plan step of either adapter into the `sendBundle` arguments it encodes. */
function decodeSendStep(kind: 'ethers' | 'viem', tx: Record<string, unknown>): DecodedSend {
  if (kind === 'ethers') {
    const decoded = IInteropCenter.decodeFunctionData('sendBundle', tx.data as Hex);
    return {
      destinationChain: decoded[0] as Hex,
      starters: decoded[1] as Array<[Hex, Hex, Hex[]]>,
      bundleAttributes: decoded[2] as Hex[],
      value: BigInt((tx.value as bigint | undefined) ?? 0n),
    };
  }

  const args = tx.args as [Hex, Array<[Hex, Hex, Hex[]]>, Hex[]];
  return {
    destinationChain: args[0],
    starters: args[1],
    bundleAttributes: args[2],
    value: BigInt((tx.value as bigint | undefined) ?? 0n),
  };
}

function sendTarget(kind: 'ethers' | 'viem', tx: Record<string, unknown>): string {
  return String(kind === 'ethers' ? tx.to : tx.address).toLowerCase();
}

describeForAdapters('adapters/withdrawals/routeInteropBundle', (kind, factory) => {
  it('sends a base-token withdrawal as a single-call bundle to the L1 chain', async () => {
    const harness = factory();
    const ctx = makeWithdrawalContext(harness, {
      route: 'base',
      protocol: 'interop-bundle',
      l1ChainId: L1_CHAIN_ID,
    });

    const res = await ROUTES[kind].build(
      { token: FORMAL_ETH_ADDRESS, amount: AMOUNT } as never,
      ctx as never,
    );

    // No approval: the base token rides as call value, nothing is pulled from the vault.
    expect(res.approvals.length).toBe(0);
    expect(res.steps.length).toBe(1);

    const step = res.steps[0];
    expect(step.key).toBe('interop-center:send-bundle');
    expect(sendTarget(kind, step.tx as Record<string, unknown>)).toBe(
      L2_INTEROP_CENTER_ADDRESS.toLowerCase(),
    );

    const sent = decodeSendStep(kind, step.tx as Record<string, unknown>);

    // The withdrawn amount is forwarded as msg.value...
    expect(sent.value).toBe(AMOUNT);

    expect(sent.starters.length).toBe(1);
    const [, data, callAttributes] = sent.starters[0];
    // ...and again as the indirect call's message value, with interopCallValue left at zero.
    expect(IAttributes.decodeFunctionData('indirectCall', callAttributes[0])[0]).toBe(AMOUNT);
    expect(IAttributes.decodeFunctionData('interopCallValue', callAttributes[1])[0]).toBe(0n);

    // The burn names no token, so the vault resolves the base token from the asset id.
    const [assetId, burnData] = AbiCoder.defaultAbiCoder().decode(
      ['bytes32', 'bytes'],
      `0x${data.slice(4)}`,
    ) as [Hex, Hex];
    expect(assetId).toBe(ctx.baseTokenAssetId);
    const [amount, receiver, token] = AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'address', 'address'],
      burnData,
    ) as [bigint, Address, Address];
    expect(amount).toBe(AMOUNT);
    expect(receiver.toLowerCase()).toBe(ADAPTER_TEST_ADDRESSES.signer.toLowerCase());
    expect(token).toBe(FORMAL_ETH_ADDRESS);
  });

  it('sends an ERC-20 withdrawal with no value and an approval when the allowance is short', async () => {
    const harness = factory();
    const ctx = makeWithdrawalContext(harness, {
      route: 'erc20-nonbase',
      protocol: 'interop-bundle',
      l1ChainId: L1_CHAIN_ID,
    });

    // Allowance short of the amount, so the plan must include the vault approval first.
    setErc20Allowance(harness, TOKEN, ctx.sender, ctx.l2NativeTokenVault, 0n);
    setL2TokenRegistration(harness, ctx.l2NativeTokenVault, TOKEN, ASSET_ID);
    if (harness.kind === 'viem') {
      harness.queueSimulateResponses(
        [
          (args) => ({
            request: {
              address: args.address,
              abi: L2NativeTokenVaultABI,
              functionName: 'ensureTokenIsRegistered',
              args: args.args,
              account: args.account,
            },
            result: ASSET_ID,
          }),
        ],
        'l2',
      );
    }

    const res = await ROUTES[kind].build({ token: TOKEN, amount: AMOUNT } as never, ctx as never);

    expect(res.approvals).toEqual([
      { token: TOKEN, spender: L2_NATIVE_TOKEN_VAULT_ADDRESS, amount: AMOUNT },
    ]);
    expect(res.steps.length).toBe(2);
    expect(res.steps[0].kind).toBe('approve:l2');
    expect(res.steps[1].key).toBe('interop-center:send-bundle');

    const sent = decodeSendStep(kind, res.steps[1].tx as Record<string, unknown>);

    // The vault pulls the ERC-20, so nothing rides as value on either hop.
    expect(sent.value).toBe(0n);
    const [, , callAttributes] = sent.starters[0];
    expect(IAttributes.decodeFunctionData('indirectCall', callAttributes[0])[0]).toBe(0n);
    expect(IAttributes.decodeFunctionData('interopCallValue', callAttributes[1])[0]).toBe(0n);
  });

  it('targets the L2 asset router and attaches a (sender, nonce)-derived salt', async () => {
    const harness = factory();
    const ctx = makeWithdrawalContext(harness, {
      route: 'base',
      protocol: 'interop-bundle',
      l1ChainId: L1_CHAIN_ID,
    });

    const res = await ROUTES[kind].build(
      { token: FORMAL_ETH_ADDRESS, amount: AMOUNT } as never,
      ctx as never,
    );
    const sent = decodeSendStep(kind, res.steps[0].tx as Record<string, unknown>);

    // ERC-7930 encodings end in the raw 20-byte address / chain reference.
    const [to] = sent.starters[0];
    expect(to.toLowerCase().endsWith(L2_ASSET_ROUTER_ADDRESS.slice(2).toLowerCase())).toBe(true);
    expect(sent.destinationChain.toLowerCase()).toContain('0001');

    // Exactly one bundle attribute: the salt. No `atomicBundle` — withdrawals are non-atomic.
    expect(sent.bundleAttributes.length).toBe(1);
    const salt = IAttributes.decodeFunctionData(
      'interopBundleSalt',
      sent.bundleAttributes[0],
    )[0] as Hex;
    expect(salt).toBe(
      keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256'],
          [ADAPTER_TEST_ADDRESSES.signer, NONCE],
        ),
      ),
    );
  });

  it('honours an explicit L1 recipient', async () => {
    const harness = factory();
    const ctx = makeWithdrawalContext(harness, {
      route: 'base',
      protocol: 'interop-bundle',
      l1ChainId: L1_CHAIN_ID,
    });
    const to = '0x5555555555555555555555555555555555555555' as Address;

    const res = await ROUTES[kind].build(
      { token: FORMAL_ETH_ADDRESS, amount: AMOUNT, to } as never,
      ctx as never,
    );
    const sent = decodeSendStep(kind, res.steps[0].tx as Record<string, unknown>);

    const [, data] = sent.starters[0];
    const [, burnData] = AbiCoder.defaultAbiCoder().decode(
      ['bytes32', 'bytes'],
      `0x${data.slice(4)}`,
    ) as [Hex, Hex];
    const [, receiver] = AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'address', 'address'],
      burnData,
    ) as [bigint, Address, Address];

    expect(receiver.toLowerCase()).toBe(to.toLowerCase());
  });
});
