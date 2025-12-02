// src/adapters/ethers/client.ts
import type { AbstractProvider, Signer } from 'ethers';
import { BrowserProvider, Contract, Interface } from 'ethers';
import type { Address } from '../../core/types/primitives';
import type { ZksRpc } from '../../core/rpc/zks';
import { zksRpcFromEthers } from './rpc';
import {
  L2_ASSET_ROUTER_ADDRESS,
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
  L2_BASE_TOKEN_ADDRESS,
} from '../../core/constants';

import {
  IBridgehubABI,
  IL1AssetRouterABI,
  IL1NullifierABI,
  IL2AssetRouterABI,
  L2NativeTokenVaultABI,
  L1NativeTokenVaultABI,
  IBaseTokenABI,
} from '../../core/abi';
import { createError } from '../../core/errors/factory';

export interface ResolvedAddresses {
  bridgehub: Address;
  l1AssetRouter: Address;
  l1Nullifier: Address;
  l1NativeTokenVault: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;
  l2BaseTokenSystem: Address;
}

export interface EthersClient {
  /** Discriminator */
  readonly kind: 'ethers';
  /** L1 read/write provider */
  readonly l1: AbstractProvider;
  /** L2 read-only provider (target ZK chain) */
  readonly l2: AbstractProvider;
  /** Signer used for sends (must be connected to L1 provider for L1 txs) */
  readonly signer: Signer;
  /** Returns a signer bound to the L1 provider (never calls connect on browser-backed signers). */
  getL1Signer(): Signer;
  /** Returns a signer bound to the L2 provider (never calls connect on browser-backed signers). */
  getL2Signer(): Signer;
  /** ZK Sync-specific RPC methods */
  readonly zks: ZksRpc;

  /** Cached resolved addresses */
  ensureAddresses(): Promise<ResolvedAddresses>;

  /** Convenience: connected ethers.Contract instances */
  contracts(): Promise<{
    bridgehub: Contract;
    l1AssetRouter: Contract;
    l1Nullifier: Contract;
    l1NativeTokenVault: Contract;
    l2AssetRouter: Contract;
    l2NativeTokenVault: Contract;
    l2BaseTokenSystem: Contract;
  }>;

  /** Clear all cached addresses/contracts. */
  refresh(): void;

  /** Lookup the base token for a given chain ID via Bridgehub.baseToken(chainId) */
  baseToken(chainId: bigint): Promise<Address>;
}

type InitArgs = {
  /** L1 provider */
  l1: AbstractProvider;
  /** L2 provider */
  l2: AbstractProvider;
  /** Signer for sending txs. */
  signer: Signer;
  /** Optional manual overrides */
  overrides?: Partial<ResolvedAddresses>;
};

/**
 * Create an EthersClient: a thin handle that carries providers/signer and
 * resolves the minimal addresses needed by resources.
 */
export function createEthersClient(args: InitArgs): EthersClient {
  const { l1, l2, signer } = args;

  // -------------------------------------------------------------------------
  // Signer binding logic
  // -------------------------------------------------------------------------
  let boundSigner = signer;

  const signerProvider = signer.provider;
  // Detect if signer is backed by a BrowserProvider (e.g., MetaMask)
  const isBrowserProvider = signerProvider instanceof BrowserProvider;

  if (!isBrowserProvider && (!boundSigner.provider || boundSigner.provider !== l1)) {
    // Regular RPC-based signer (e.g. JsonRpcSigner, Wallet)
    boundSigner = signer.connect(l1);
  } else if (isBrowserProvider && signerProvider) {
    // For BrowserProvider signers, we trust their internal connection.
    // Run an async network check in the background (non-blocking)
    void (async () => {
      try {
        const [signerNet, l1Net] = await Promise.all([
          signerProvider.getNetwork(),
          l1.getNetwork(),
        ]);

        if (signerNet.chainId !== l1Net.chainId) {
          // Non-fatal consistency warning
          const warning = createError('STATE', {
            message:
              `BrowserProvider signer chainId (${signerNet.chainId}) != ` +
              `L1 provider chainId (${l1Net.chainId}). Ensure the wallet is connected to the correct network.`,
            resource: 'helpers',
            operation: 'client.browserProvider.networkMismatch',
            context: {
              signerChainId: signerNet.chainId,
              l1ChainId: l1Net.chainId,
            },
          });
          // eslint-disable-next-line no-console
          console.debug('[zksync-sdk] non-fatal warning:', warning);
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        // ignore
      }
    })();
  }

  // lazily bind zks rpc to the L2 provider
  const zks = zksRpcFromEthers(l2);

  // Caches
  let addrCache: ResolvedAddresses | undefined;
  let cCache:
    | {
        bridgehub: Contract;
        l1AssetRouter: Contract;
        l1Nullifier: Contract;
        l1NativeTokenVault: Contract;
        l2AssetRouter: Contract;
        l2NativeTokenVault: Contract;
        l2BaseTokenSystem: Contract;
      }
    | undefined;

  async function ensureAddresses(): Promise<ResolvedAddresses> {
    if (addrCache) return addrCache;

    // Bridgehub
    const bridgehub = args.overrides?.bridgehub ?? (await zks.getBridgehubAddress());

    // L1 AssetRouter via Bridgehub.assetRouter()
    const IBridgehub = new Interface(IBridgehubABI);
    const bh = new Contract(bridgehub, IBridgehub, l1);
    const l1AssetRouter = args.overrides?.l1AssetRouter ?? ((await bh.assetRouter()) as Address);

    // L1Nullifier via L1AssetRouter.L1_NULLIFIER()
    const IL1AssetRouter = new Interface(IL1AssetRouterABI);
    const ar = new Contract(l1AssetRouter, IL1AssetRouter, l1);
    const l1Nullifier = args.overrides?.l1Nullifier ?? ((await ar.L1_NULLIFIER()) as Address);

    // L1NativeTokenVault via L1Nullifier.l1NativeTokenVault()
    const IL1Nullifier = new Interface(IL1NullifierABI);
    const nf = new Contract(l1Nullifier, IL1Nullifier, l1);
    const l1NativeTokenVault =
      args.overrides?.l1NativeTokenVault ?? ((await nf.l1NativeTokenVault()) as Address);

    // L2AssetRouter
    const l2AssetRouter = args.overrides?.l2AssetRouter ?? L2_ASSET_ROUTER_ADDRESS;

    // L2NativeTokenVault
    const l2NativeTokenVault = args.overrides?.l2NativeTokenVault ?? L2_NATIVE_TOKEN_VAULT_ADDRESS;

    // L2BaseToken
    const l2BaseTokenSystem = args.overrides?.l2BaseTokenSystem ?? L2_BASE_TOKEN_ADDRESS;

    addrCache = {
      bridgehub,
      l1AssetRouter,
      l1Nullifier,
      l1NativeTokenVault,
      l2AssetRouter,
      l2NativeTokenVault,
      l2BaseTokenSystem,
    };
    return addrCache;
  }

  // lazily create connected contract instances for convenience
  async function contracts() {
    if (cCache) return cCache;
    const a = await ensureAddresses();

    cCache = {
      bridgehub: new Contract(a.bridgehub, IBridgehubABI, l1),
      l1AssetRouter: new Contract(a.l1AssetRouter, IL1AssetRouterABI, l1),
      l1Nullifier: new Contract(a.l1Nullifier, IL1NullifierABI, l1),
      l1NativeTokenVault: new Contract(a.l1NativeTokenVault, L1NativeTokenVaultABI, l1),
      l2AssetRouter: new Contract(a.l2AssetRouter, IL2AssetRouterABI, l2),
      l2NativeTokenVault: new Contract(a.l2NativeTokenVault, L2NativeTokenVaultABI, l2),
      l2BaseTokenSystem: new Contract(a.l2BaseTokenSystem, IBaseTokenABI, l2),
    };
    return cCache;
  }

  // clear caches
  function refresh() {
    addrCache = undefined;
    cCache = undefined;
  }

  function resolveSignerFor(provider: AbstractProvider): Signer {
    const signerProvider = boundSigner.provider;

    if (signerProvider === provider) {
      return boundSigner;
    }

    if (!isBrowserProvider && typeof boundSigner.connect === 'function') {
      return boundSigner.connect(provider);
    }

    if (!signerProvider) {
      throw createError('STATE', {
        resource: 'helpers',
        message: 'Signer has no associated provider; cannot resolve requested signer.',
        operation: 'client.resolveSignerFor',
      });
    }

    return boundSigner;
  }

  // lookup base token for a given chain ID via Bridgehub.baseToken(chainId)
  async function baseToken(chainId: bigint): Promise<Address> {
    const { bridgehub } = await ensureAddresses();
    const bh = new Contract(bridgehub, IBridgehubABI, l1);

    return (await bh.baseToken(chainId)) as Address;
  }

  const client: EthersClient = {
    kind: 'ethers',
    l1,
    l2,
    signer: boundSigner,
    getL1Signer() {
      return resolveSignerFor(l1);
    },
    getL2Signer() {
      return resolveSignerFor(l2);
    },
    zks,
    ensureAddresses,
    contracts,
    refresh,
    baseToken,
  };

  return client;
}

export type { InitArgs as EthersClientInit };
