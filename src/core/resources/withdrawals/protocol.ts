// src/core/resources/withdrawals/protocol.ts
//
// Detection of which L2 -> L1 withdrawal protocol a chain speaks.
//
// Protocol v32 replaced both withdrawal entry points and the L1 finalization entry point:
//
//   initiation  v31: L2BaseToken.withdraw(l1Receiver)                      (base token)
//                    L2AssetRouter.withdraw(assetId, transferData)         (ERC-20)
//               v32: InteropCenter.sendBundle(l1Chain, [starter], attrs)   (both, unified)
//
//   finalization v31: L1Nullifier.finalizeDeposit(FinalizeL1DepositParams)
//                v32: L1InteropHandler.executeBundle(bundle, MessageInclusionProof)
//
// Neither side is backwards compatible: `L2BaseToken.withdraw`, `L2AssetRouter.withdraw`,
// `L1Nullifier.finalizeDeposit` and `L1Nullifier.isWithdrawalFinalized` were all removed in v32.
// The SDK therefore has to pick a protocol per chain before building anything.

import type { Address, ProtocolVersion } from '../../types/primitives';
import {
  L2_ATOMIC_FLOW_MANAGER_ADDRESS,
  L2_INTEROP_ATTRIBUTE_PARSER_ADDRESS,
} from '../../constants';

/**
 * Which withdrawal protocol a chain speaks.
 *
 * - `legacy-withdrawal` — protocol v31 and below: dedicated `withdraw` entry points, finalized on
 *   the `L1Nullifier`.
 * - `interop-bundle` — protocol v32 and above: withdrawals are single-call interop bundles
 *   destined for the L1 chain, finalized on the `L1InteropHandler`.
 */
export type WithdrawalProtocol = 'legacy-withdrawal' | 'interop-bundle';

/** First protocol minor version that uses the interop-bundle withdrawal protocol. */
export const MIN_INTEROP_WITHDRAWAL_MINOR = 32;

/** How the protocol was determined — surfaced for logging and error context. */
export type WithdrawalProtocolSource =
  | { via: 'override' }
  | { via: 'protocol-version'; version: ProtocolVersion }
  | { via: 'code-probe'; address: Address };

export interface WithdrawalProtocolDetection {
  protocol: WithdrawalProtocol;
  source: WithdrawalProtocolSource;
}

/**
 * Probes a chain has to expose for detection. Both are allowed to fail: `protocolVersion` returns
 * `undefined` when the version cannot be read (unregistered CTM, restricted RPC, a node that does
 * not expose the Bridgehub), and detection then falls back to the code probe.
 */
export interface WithdrawalProtocolProbes {
  /** Per-chain protocol version, or `undefined` when it cannot be read. */
  protocolVersion(): Promise<ProtocolVersion | undefined>;
  /** True when the given L2 address holds non-empty bytecode. */
  hasCodeAt(address: Address): Promise<boolean>;
}

/** Decides the protocol from a known protocol version. */
export function protocolFromVersion(version: ProtocolVersion): WithdrawalProtocol {
  const [, minor] = version;
  return minor >= MIN_INTEROP_WITHDRAWAL_MINOR ? 'interop-bundle' : 'legacy-withdrawal';
}

/**
 * Built-ins that exist only from protocol v32 on. A hit at *any* of them means the chain speaks the
 * interop-bundle protocol.
 *
 * More than one address is probed because which of these a v32 chain actually has depends on both
 * its VM and which point of the v32 line it was deployed from — verified against a live v32 ZKsync
 * OS chain that has the AtomicFlowManager but predates the InteropAttributeParser. Ordered
 * cheapest-to-most-likely-conclusive: the parser is force-deployed on both VMs in the release line,
 * so it settles the common case first; the atomic built-ins cover the earlier ZKsync-OS-only line.
 * Neither is load-bearing on its own.
 */
const V32_SENTINELS: readonly Address[] = [
  L2_INTEROP_ATTRIBUTE_PARSER_ADDRESS,
  L2_ATOMIC_FLOW_MANAGER_ADDRESS,
];

/**
 * Detects the withdrawal protocol of the connected L2.
 *
 * Two probes, in order of trustworthiness:
 *
 * 1. **Per-chain protocol version.** `ChainTypeManager.getProtocolVersion(chainId)` is
 *    authoritative and cheap, so it wins whenever it can be read.
 * 2. **Bytecode probe.** Falls back to asking the L2 whether any {@link V32_SENTINELS} address has
 *    code. Only reached when the version read failed, so the extra `eth_getCode` calls are confined
 *    to an already-degraded path.
 *
 * A caller-supplied `override` short-circuits both probes, which is the escape hatch for chains
 * whose Bridgehub is not reachable from the configured L1 provider.
 */
export async function detectWithdrawalProtocol(
  probes: WithdrawalProtocolProbes,
  override?: WithdrawalProtocol,
): Promise<WithdrawalProtocolDetection> {
  if (override) {
    return { protocol: override, source: { via: 'override' } };
  }

  const version = await probes.protocolVersion();
  if (version) {
    return { protocol: protocolFromVersion(version), source: { via: 'protocol-version', version } };
  }

  for (const address of V32_SENTINELS) {
    if (await probes.hasCodeAt(address)) {
      return { protocol: 'interop-bundle', source: { via: 'code-probe', address } };
    }
  }

  return {
    protocol: 'legacy-withdrawal',
    source: { via: 'code-probe', address: V32_SENTINELS[0] },
  };
}
