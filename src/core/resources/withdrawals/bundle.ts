// src/core/resources/withdrawals/bundle.ts
//
// Builds the interop bundle that carries an L2 -> L1 withdrawal under protocol v32+.
//
// A withdrawal is the degenerate interop bundle: exactly one *indirect* call, destined for the L1
// chain, targeting the L2 AssetRouter. The router resolves it into a call to the L1 asset router's
// `finalizeDeposit` on the other side. Base-token and ERC-20 withdrawals differ only in how the
// value reaches the router:
//
//   base token — the withdrawn amount rides as the indirect call's message value, and the burn
//                token address is left zero so the NativeTokenVault resolves the base token from
//                the asset id.
//   ERC-20     — the amount is pulled from the sender by the NativeTokenVault (hence the approval),
//                the indirect call carries no value, and the burn names the L2 token.
//
// In both cases `interopCallValue` is zero: nothing is credited to the recipient as *L1* base token
// by the interop machinery itself; the asset router mints/releases on the L1 side.

import type { Address, Hex } from '../../types/primitives';
import type { InteropAddressCodec, InteropStarter } from '../interop/plan';

/** Attribute encoders the bundle builder needs, injected by the adapter. */
export interface WithdrawalAttributeCodec {
  /** `indirectCall(uint256 indirectCallMessageValue)` */
  indirectCall(messageValue: bigint): Hex;
  /** `interopCallValue(uint256 interopCallValue)` */
  interopCallValue(amount: bigint): Hex;
  /** `interopBundleSalt(bytes32 salt)` — required on v32, see {@link withdrawalBundleSalt}. */
  interopBundleSalt(salt: Hex): Hex;
}

/** ABI encoders the bundle builder needs, injected by the adapter. */
export interface WithdrawalTransferDataCodec {
  /** `DataEncoding.encodeBridgeBurnData(amount, remoteReceiver, maybeTokenAddress)` */
  encodeBridgeBurnData(amount: bigint, receiver: Address, token: Address): Hex;
  /** `DataEncoding.encodeAssetRouterBridgehubDepositData(assetId, transferData)` */
  encodeAssetRouterDepositData(assetId: Hex, transferData: Hex): Hex;
}

export interface BuildWithdrawalBundleInput {
  /** Asset id of the withdrawn asset, as registered in the NativeTokenVault. */
  assetId: Hex;
  /** Amount to withdraw. */
  amount: bigint;
  /** L1 recipient of the funds. */
  l1Receiver: Address;
  /**
   * L2 token being burned, or the zero address for a base-token withdrawal (which lets the vault
   * resolve the token from `assetId`).
   */
  l2Token: Address;
  /** True when withdrawing the chain's base token. */
  isBaseToken: boolean;
  /** Chain id of L1 — the bundle's destination. */
  l1ChainId: bigint;
  /** L2 AssetRouter address (the bundle's single call target). */
  l2AssetRouter: Address;
  /** Unique-per-sender salt; see {@link withdrawalBundleSalt}. */
  salt: Hex;
  codec: InteropAddressCodec;
  attributes: WithdrawalAttributeCodec;
  transferData: WithdrawalTransferDataCodec;
}

export interface WithdrawalBundle {
  /** ERC-7930 encoded destination chain (L1). */
  destinationChain: Hex;
  /** The bundle's single call starter. */
  starters: InteropStarter[];
  /** Bundle-level attributes. */
  bundleAttributes: Hex[];
  /**
   * `msg.value` for the `sendBundle` call. Non-zero only for base-token withdrawals, where the
   * withdrawn amount is forwarded as the indirect call's message value.
   *
   * L2 -> L1 withdrawals pay no interop protocol fee, so nothing else is added here.
   */
  value: bigint;
}

/**
 * Builds the `sendBundle` arguments for a withdrawal.
 *
 * The returned `value` is exactly the amount forwarded to the indirect call — callers must not add
 * an interop fee on top: unlike L2 -> L2 bundles, L1-destined withdrawal bundles are free.
 */
export function buildWithdrawalBundle(input: BuildWithdrawalBundleInput): WithdrawalBundle {
  const {
    assetId,
    amount,
    l1Receiver,
    l2Token,
    isBaseToken,
    l1ChainId,
    l2AssetRouter,
    salt,
    codec,
    attributes,
    transferData,
  } = input;

  const burnData = transferData.encodeBridgeBurnData(amount, l1Receiver, l2Token);
  const depositData = transferData.encodeAssetRouterDepositData(assetId, burnData);

  // Base token: the amount travels as the indirect call's message value. ERC-20: the vault pulls it
  // from the sender, so the indirect call carries nothing.
  const indirectCallMessageValue = isBaseToken ? amount : 0n;

  const starter: InteropStarter = [
    codec.formatAddress(l2AssetRouter),
    depositData,
    [attributes.indirectCall(indirectCallMessageValue), attributes.interopCallValue(0n)],
  ];

  return {
    destinationChain: codec.formatChain(l1ChainId),
    starters: [starter],
    // No `atomicBundle` attribute: L2 -> L1 withdrawals are non-atomic and are published to L1 as a
    // `BUNDLE_IDENTIFIER`-prefixed message, which is what the L1 handler proves inclusion of.
    bundleAttributes: [attributes.interopBundleSalt(salt)],
    value: indirectCallMessageValue,
  };
}

/**
 * Derives the bundle salt for a withdrawal.
 *
 * v32 replaced the InteropCenter's per-sender bundle nonce with a user-supplied salt: the center
 * stores `keccak256(sender, salt)` and rejects a repeat, so every bundle from the same sender needs
 * a fresh value. Deriving it from `(sender, l2 nonce)` rather than randomness keeps the resulting
 * bundle hash reproducible for a given transaction — which matters because the caller may want to
 * predict the hash before sending — while the monotonic nonce guarantees freshness.
 */
export interface WithdrawalSaltInput {
  sender: Address;
  nonce: number;
  /** `keccak256(abi.encode(address, uint256))`, injected by the adapter. */
  hash: (sender: Address, nonce: bigint) => Hex;
}

export function withdrawalBundleSalt(input: WithdrawalSaltInput): Hex {
  return input.hash(input.sender, BigInt(input.nonce));
}
