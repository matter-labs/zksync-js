// src/adapters/viem/client.ts
import type {
  PublicClient,
  WalletClient,
  Account,
  Chain,
  Transport,
  GetContractReturnType,
  Abi,
} from 'viem';
import { getContract, createPublicClient, createWalletClient, http, custom } from 'viem';
import type { ZksRpc } from '../../core/rpc/zks';
import { zksRpcFromViem } from './rpc';

import type { Address } from '../../core/types/primitives'; // ← use your core Address type
import {
  L2_ASSET_ROUTER_ADDRESS,
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
  L2_BASE_TOKEN_ADDRESS,
  L2_INTEROP_CENTER_ADDRESS,
  L2_INTEROP_HANDLER_ADDRESS,
  L2_MESSAGE_VERIFICATION_ADDRESS,
} from '../../core/constants';

// ABIs from internal snapshot (same as ethers adapter)
import {
  IBridgehubABI,
  IL1AssetRouterABI,
  IL1NullifierABI,
  IL2AssetRouterABI,
  L2NativeTokenVaultABI,
  L1NativeTokenVaultABI,
  IBaseTokenABI,
  InteropCenterABI,
  IInteropHandlerABI,
  L2MessageVerificationABI,
} from '../../core/abi';

export interface ResolvedAddresses {
  bridgehub: Address;
  l1AssetRouter: Address;
  l1Nullifier: Address;
  l1NativeTokenVault: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;
  l2BaseTokenSystem: Address;
  interopCenter: Address;
  interopHandler: Address;
  l2MessageVerification: Address;
}

export interface ViemClient {
  readonly kind: 'viem';
  readonly l1: PublicClient;
  readonly l2: PublicClient;
  readonly l1Wallet: WalletClient<Transport, Chain | undefined, Account>;
  readonly l2Wallet?: WalletClient<Transport, Chain | undefined, Account>;
  readonly account: Account;
  readonly zks: ZksRpc;

  ensureAddresses(): Promise<ResolvedAddresses>;
  getL2Wallet(): WalletClient<Transport, Chain | undefined, Account>;
  contracts(): Promise<{
    bridgehub: GetContractReturnType<typeof IBridgehubABI, PublicClient>;
    l1AssetRouter: GetContractReturnType<typeof IL1AssetRouterABI, PublicClient>;
    l1Nullifier: GetContractReturnType<typeof IL1NullifierABI, PublicClient>;
    l1NativeTokenVault: GetContractReturnType<typeof L1NativeTokenVaultABI, PublicClient>;
    l2AssetRouter: GetContractReturnType<typeof IL2AssetRouterABI, PublicClient>;
    l2NativeTokenVault: GetContractReturnType<typeof L2NativeTokenVaultABI, PublicClient>;
    l2BaseTokenSystem: GetContractReturnType<typeof IBaseTokenABI, PublicClient>;
    interopCenter: GetContractReturnType<typeof InteropCenterABI, PublicClient>;
    interopHandler: GetContractReturnType<typeof IInteropHandlerABI, PublicClient>;
    l2MessageVerification: GetContractReturnType<typeof L2MessageVerificationABI, PublicClient>;
  }>;
  refresh(): void;
  baseToken(chainId: bigint): Promise<Address>;

  registerChain(chainId: bigint, clientOrUrl: PublicClient | string): void;
  registerChains(map: Record<string, PublicClient | string>): void;
  getPublicClient(chainId: bigint): PublicClient | undefined;
  requirePublicClient(chainId: bigint): PublicClient;
  listChains(): bigint[];

  walletFor(target?: 'l1' | bigint): Promise<WalletClient<Transport, Chain | undefined, Account>>;
}

type InitArgs = {
  l1: PublicClient;
  l2: PublicClient;
  l1Wallet: WalletClient<Transport, Chain | undefined, Account>;
  l2Wallet?: WalletClient<Transport, Chain | undefined, Account>;
  chains?: Record<string, PublicClient | string>;
  overrides?: Partial<ResolvedAddresses>;
};

export function createViemClient(args: InitArgs): ViemClient {
  const { l1, l2, l1Wallet, l2Wallet } = args;
  if (!l1Wallet.account) {
    throw new Error('WalletClient must have an account configured.');
  }
  if (l2Wallet && !l2Wallet.account) throw new Error('l2Wallet provided without an account.');

  const zks = zksRpcFromViem(l2);

  let addrCache: ResolvedAddresses | undefined;
  const chainMap = new Map<bigint, PublicClient>();
  if (args.chains) {
    for (const [k, p] of Object.entries(args.chains)) {
      const id = BigInt(k);
      const client = typeof p === 'string' ? createPublicClient({ transport: http(p) }) : p;
      chainMap.set(id, client);
    }
  }
  let cCache:
    | {
        bridgehub: GetContractReturnType<typeof IBridgehubABI, PublicClient>;
        l1AssetRouter: GetContractReturnType<typeof IL1AssetRouterABI, PublicClient>;
        l1Nullifier: GetContractReturnType<typeof IL1NullifierABI, PublicClient>;
        l1NativeTokenVault: GetContractReturnType<typeof L1NativeTokenVaultABI, PublicClient>;
        l2AssetRouter: GetContractReturnType<typeof IL2AssetRouterABI, PublicClient>;
        l2NativeTokenVault: GetContractReturnType<typeof L2NativeTokenVaultABI, PublicClient>;
        l2BaseTokenSystem: GetContractReturnType<typeof IBaseTokenABI, PublicClient>;
        interopCenter: GetContractReturnType<typeof InteropCenterABI, PublicClient>;
        interopHandler: GetContractReturnType<typeof IInteropHandlerABI, PublicClient>;
        l2MessageVerification: GetContractReturnType<typeof L2MessageVerificationABI, PublicClient>;
      }
    | undefined;

  async function ensureAddresses(): Promise<ResolvedAddresses> {
    if (addrCache) return addrCache;

    // Bridgehub via zks_getBridgehubContract
    const bridgehub = args.overrides?.bridgehub ?? (await zks.getBridgehubAddress());

    // L1 AssetRouter via Bridgehub.assetRouter()
    const l1AssetRouter =
      args.overrides?.l1AssetRouter ??
      ((await l1.readContract({
        address: bridgehub,
        abi: IBridgehubABI as Abi,
        functionName: 'assetRouter',
      })) as Address);

    // L1Nullifier via L1AssetRouter.L1_NULLIFIER()
    const l1Nullifier =
      args.overrides?.l1Nullifier ??
      ((await l1.readContract({
        address: l1AssetRouter,
        abi: IL1AssetRouterABI as Abi,
        functionName: 'L1_NULLIFIER',
      })) as Address);

    // L1NativeTokenVault via L1Nullifier.l1NativeTokenVault()
    const l1NativeTokenVault =
      args.overrides?.l1NativeTokenVault ??
      ((await l1.readContract({
        address: l1Nullifier,
        abi: IL1NullifierABI as Abi,
        functionName: 'l1NativeTokenVault',
      })) as Address);

    // L2 addresses from constants (overridable)
    const l2AssetRouter = args.overrides?.l2AssetRouter ?? L2_ASSET_ROUTER_ADDRESS;
    const l2NativeTokenVault = args.overrides?.l2NativeTokenVault ?? L2_NATIVE_TOKEN_VAULT_ADDRESS;
    const l2BaseTokenSystem = args.overrides?.l2BaseTokenSystem ?? L2_BASE_TOKEN_ADDRESS;
    const interopCenter = args.overrides?.interopCenter ?? L2_INTEROP_CENTER_ADDRESS;
    const interopHandler = args.overrides?.interopHandler ?? L2_INTEROP_HANDLER_ADDRESS;
    const l2MessageVerification =
      args.overrides?.l2MessageVerification ?? L2_MESSAGE_VERIFICATION_ADDRESS;

    addrCache = {
      bridgehub,
      l1AssetRouter,
      l1Nullifier,
      l1NativeTokenVault,
      l2AssetRouter,
      l2NativeTokenVault,
      l2BaseTokenSystem,
      interopCenter,
      interopHandler,
      l2MessageVerification,
    };
    return addrCache;
  }

  async function contracts() {
    if (cCache) return cCache;
    const a = await ensureAddresses();

    cCache = {
      bridgehub: getContract({ address: a.bridgehub, abi: IBridgehubABI, client: l1 }),
      l1AssetRouter: getContract({ address: a.l1AssetRouter, abi: IL1AssetRouterABI, client: l1 }),
      l1Nullifier: getContract({ address: a.l1Nullifier, abi: IL1NullifierABI, client: l1 }),
      l1NativeTokenVault: getContract({
        address: a.l1NativeTokenVault,
        abi: L1NativeTokenVaultABI,
        client: l1,
      }),
      l2AssetRouter: getContract({ address: a.l2AssetRouter, abi: IL2AssetRouterABI, client: l2 }),
      l2NativeTokenVault: getContract({
        address: a.l2NativeTokenVault,
        abi: L2NativeTokenVaultABI,
        client: l2,
      }),
      l2BaseTokenSystem: getContract({
        address: a.l2BaseTokenSystem,
        abi: IBaseTokenABI,
        client: l2,
      }),
      interopCenter: getContract({ address: a.interopCenter, abi: InteropCenterABI, client: l2 }),
      interopHandler: getContract({ address: a.interopHandler, abi: IInteropHandlerABI, client: l2 }),
      l2MessageVerification: getContract({
        address: a.l2MessageVerification,
        abi: L2MessageVerificationABI,
        client: l2,
      }),
    };
    return cCache;
  }

  function refresh() {
    addrCache = undefined;
    cCache = undefined;
  }

  async function baseToken(chainId: bigint): Promise<Address> {
    const { bridgehub } = await ensureAddresses();
    const token = (await l1.readContract({
      address: bridgehub,
      abi: IBridgehubABI as Abi,
      functionName: 'baseToken',
      args: [chainId],
    })) as Address;
    return token;
  }

  let lazyL2: WalletClient<Transport, Chain | undefined, Account> | undefined;
  function getL2Wallet(): WalletClient<Transport, Chain | undefined, Account> {
    if (l2Wallet) return l2Wallet;
    if (!lazyL2) {
      lazyL2 = createWalletClient({
        account: l1Wallet.account,
        transport: custom({ request: l2.request }),
        chain: l2.chain,
      });
    }
    return lazyL2;
  }

  function registerChain(chainId: bigint, clientOrUrl: PublicClient | string) {
    const client =
      typeof clientOrUrl === 'string' ? createPublicClient({ transport: http(clientOrUrl) }) : clientOrUrl;
    chainMap.set(chainId, client);
  }

  function registerChains(map: Record<string, PublicClient | string>) {
    for (const [k, p] of Object.entries(map)) {
      registerChain(BigInt(k), p);
    }
  }

  function getPublicClient(chainId: bigint): PublicClient | undefined {
    return chainMap.get(chainId);
  }

  function requirePublicClient(chainId: bigint): PublicClient {
    const client = chainMap.get(chainId);
    if (!client) {
      throw new Error(`No PublicClient registered for chainId ${chainId}.`);
    }
    return client;
  }

  const walletCache = new Map<bigint, WalletClient<Transport, Chain | undefined, Account>>();
  async function walletFor(target?: 'l1' | bigint) {
    if (target === 'l1') return l1Wallet;
    if (target == null) return getL2Wallet();

    const chainId = target;
    if (walletCache.has(chainId)) return walletCache.get(chainId)!;

    const pub = requirePublicClient(chainId);
    const wallet = createWalletClient({
      account: l1Wallet.account,
      transport: custom({ request: pub.request }),
      chain: pub.chain,
    });
    walletCache.set(chainId, wallet);
    return wallet;
  }

  return {
    kind: 'viem',
    l1,
    l2,
    l1Wallet,
    l2Wallet,
    account: l1Wallet.account,
    zks,
    ensureAddresses,
    contracts,
    refresh,
    baseToken,
    getL2Wallet,
    registerChain,
    registerChains,
    getPublicClient,
    requirePublicClient,
    listChains: () => Array.from(chainMap.keys()),
    walletFor,
  };
}

export type { InitArgs as ViemClientInit };
