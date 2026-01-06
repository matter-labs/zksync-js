import { Interface } from 'ethers';
import type { Signer } from 'ethers';
import { describe } from 'bun:test';
import type { Account, PublicClient, Transport, WalletClient } from 'viem';

import { createEthersClient, type EthersClient } from '../ethers/client';
import { createViemClient, type ViemClient } from '../viem/client';
import type { ResolvedAddresses as EthersResolvedAddresses } from '../ethers/client';
import type { ResolvedAddresses as ViemResolvedAddresses } from '../viem/client';
import {
  IBridgehubABI,
  IL1AssetRouterABI,
  IL1NullifierABI,
  IERC20ABI,
  L2NativeTokenVaultABI,
} from '../../core/abi.ts';
import type { Address } from '../../core/types/primitives';
import {
  L2_ASSET_ROUTER_ADDRESS,
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
  L2_BASE_TOKEN_ADDRESS,
} from '../../core/constants';

const IBridgehub = new Interface(IBridgehubABI as any);
const IL1AssetRouter = new Interface(IL1AssetRouterABI as any);
const IL1Nullifier = new Interface(IL1NullifierABI as any);
const IERC20 = new Interface(IERC20ABI as any);
const L2NativeTokenVault = new Interface(L2NativeTokenVaultABI as any);

const lower = (value: string) => value.toLowerCase();
type ResultValue = unknown | unknown[];

class CallRegistry {
  private encoded = new Map<string, string>();
  private values = new Map<string, ResultValue>();

  set(address: Address, iface: Interface, fn: string, result: ResultValue, args: unknown[] = []) {
    const addr = lower(address);
    const sel = iface.getFunction(fn)!.selector.toLowerCase();
    const encoded = iface.encodeFunctionResult(
      fn as any,
      Array.isArray(result) ? result : [result],
    );

    this.encoded.set(`${addr}|${sel}`, encoded);
    this.values.set(`${addr}|${fn}|${this.argsKey(args)}`, result);
  }

  getEncoded(address: string, data: string) {
    return this.encoded.get(`${lower(address)}|${data.slice(0, 10).toLowerCase()}`);
  }

  getValue(address: string, fn: string, args: unknown[] = []) {
    return this.values.get(`${lower(address)}|${fn}|${this.argsKey(args)}`);
  }

  private argsKey(args: unknown[]) {
    return JSON.stringify(args, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
  }
}

export const ADAPTER_TEST_ADDRESSES = {
  bridgehub: '0xb000000000000000000000000000000000000000' as Address,
  l1AssetRouter: '0xa000000000000000000000000000000000000000' as Address,
  l1Nullifier: '0xc000000000000000000000000000000000000000' as Address,
  l1NativeTokenVault: '0xd000000000000000000000000000000000000000' as Address,
  baseTokenFor324: '0xbee0000000000000000000000000000000000000' as Address,
  signer: '0x1111111111111111111111111111111111111111' as Address,
} as const;

type BaseOpts = {
  seed?: boolean;
  overrides?: Partial<EthersResolvedAddresses> | Partial<ViemResolvedAddresses>;
  baseToken?: Address;
};

type EthersHarness = {
  kind: 'ethers';
  client: EthersClient;
  l1: {
    call: (tx: { to?: string; data?: string }) => Promise<string>;
    estimateGas: (tx: unknown) => Promise<bigint>;
    getFeeData: () => Promise<{
      gasPrice: bigint;
      maxFeePerGas?: bigint;
      maxPriorityFeePerGas?: bigint;
    }>;
    getGasPrice: () => Promise<bigint>;
  };
  l2: {
    send: (method: string, params: unknown[]) => Promise<unknown>;
    estimateGas: (tx: unknown) => Promise<bigint>;
    getNetwork: () => Promise<{ chainId: bigint }>;
    getFeeData: () => Promise<{
      gasPrice: bigint;
      maxFeePerGas?: bigint;
      maxPriorityFeePerGas?: bigint;
    }>;
    getGasPrice: () => Promise<bigint>;
    getCode: (address: string) => Promise<string>;
  };
  signer: Signer;
  registry: CallRegistry;
  setEstimateGas(value: bigint | Error | undefined): void;
  onEstimateGas(cb: ((tx: unknown) => void) | undefined): void;
  setL2EstimateGas(value: bigint | Error | undefined): void;
  onL2EstimateGas(cb: ((tx: unknown) => void) | undefined): void;
};

type ViemHarness = {
  kind: 'viem';
  client: ViemClient;
  l1: PublicClient;
  l2: PublicClient;
  l1Wallet: WalletClient<Transport, any, Account>;
  l2Wallet: WalletClient<Transport, any, Account>;
  registry: CallRegistry;
  setSimulateResponse(value: SimulateResponder | undefined, target?: 'l1' | 'l2'): void;
  setSimulateError(error: Error | undefined, target?: 'l1' | 'l2'): void;
  lastSimulateArgs(target?: 'l1' | 'l2'): unknown;
  queueSimulateResponses(responses: SimulateResponder[], target?: 'l1' | 'l2'): void;
  setEstimateGas(value: bigint | Error | undefined, target?: 'l1' | 'l2'): void;
};

export type AdapterHarness = EthersHarness | ViemHarness;

type EthersL1State = {
  registry: CallRegistry;
  estimateGasValue?: bigint | Error;
  estimateGasSpy?: (tx: unknown) => void;
};

function makeEthersL1(state: EthersL1State) {
  return {
    async call(tx: { to?: string; data?: string }) {
      if (!tx.to || !tx.data) throw new Error('ethers mock: missing to/data');
      const out = state.registry.getEncoded(tx.to, tx.data);
      if (!out)
        throw new Error(`ethers mock: no mapping for ${lower(tx.to)}|${tx.data.slice(0, 10)}`);
      return out;
    },
    async estimateGas(tx: unknown) {
      state.estimateGasSpy?.(tx);
      const { estimateGasValue } = state;
      if (estimateGasValue instanceof Error) throw estimateGasValue;
      if (typeof estimateGasValue === 'bigint') return estimateGasValue;
      return 100_000n;
    },
    async getFeeData() {
      return { gasPrice: 5n, maxFeePerGas: 5n, maxPriorityFeePerGas: 1n };
    },
    async getGasPrice() {
      return 5n;
    },
  };
}

type EthersL2State = {
  bridgehub: Address;
  registry: CallRegistry;
  estimateGasValue?: bigint | Error;
  estimateGasSpy?: (tx: unknown) => void;
};

function makeEthersL2(state: EthersL2State) {
  return {
    async call(tx: { to?: string; data?: string }) {
      if (!tx.to || !tx.data) throw new Error('ethers mock l2: missing to/data');
      const out = state.registry.getEncoded(tx.to, tx.data);
      if (!out)
        throw new Error(`ethers mock l2: no mapping for ${lower(tx.to)}|${tx.data.slice(0, 10)}`);
      return out;
    },
    async send(method: string, _params: unknown[]) {
      if (method === 'zks_getBridgehubContract') return state.bridgehub;
      throw new Error(`ethers mock l2: unexpected method ${method}`);
    },
    async estimateGas(tx: unknown) {
      state.estimateGasSpy?.(tx);
      const { estimateGasValue } = state;
      if (estimateGasValue instanceof Error) throw estimateGasValue;
      if (typeof estimateGasValue === 'bigint') return estimateGasValue;
      return 100_000n;
    },
    async getNetwork() {
      return { chainId: 324n };
    },
    async getFeeData() {
      return { gasPrice: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n };
    },
    async getGasPrice() {
      return 1n;
    },
    async getCode(_address: string) {
      return '0x01';
    },
  };
}

function makeSigner(l1: any, addr: Address) {
  return {
    provider: undefined as any,
    connect(p: any) {
      this.provider = p;
      return this;
    },
    async getAddress() {
      return addr;
    },
  } as Signer;
}

type SimulateResponder =
  | { request: unknown; result?: unknown }
  | ((args: unknown) => { request: unknown; result?: unknown });

type ViemClientState = {
  registry: CallRegistry;
  bridgehub: Address;
  simulateResponse?: SimulateResponder;
  simulateQueue?: SimulateResponder[];
  simulateError?: Error;
  lastArgs?: unknown;
  estimateGasValue?: bigint | Error;
  gasPrice?: bigint;
  fees?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
  code?: string;
  chainId?: bigint;
};

function makeViemClient(state: ViemClientState): PublicClient {
  return {
    transport: { type: 'mock', value: {} },
    async readContract(args: { address: Address; functionName: string; args?: unknown[] }) {
      const value = state.registry.getValue(args.address, args.functionName, args.args ?? []);
      if (value === undefined) {
        throw new Error(`viem mock: no mapping for ${lower(args.address)}|${args.functionName}`);
      }
      return value as any;
    },
    async request({ method }: { method: string; params?: unknown[] }) {
      if (method === 'zks_getBridgehubContract') return state.bridgehub;
      throw new Error(`viem mock: unexpected method ${method}`);
    },
    async simulateContract(args: unknown) {
      state.lastArgs = args;
      if (state.simulateError) throw state.simulateError;
      const queued = state.simulateQueue?.shift();
      if (queued) {
        if (typeof queued === 'function') return queued(args);
        return queued;
      }
      if (state.simulateResponse) {
        if (typeof state.simulateResponse === 'function') {
          return state.simulateResponse(args);
        }
        return state.simulateResponse;
      }
      const {
        address,
        abi,
        functionName,
        value,
        account,
        args: fnArgs,
      } = args as {
        address: Address;
        abi: unknown;
        functionName: string;
        value?: unknown;
        account?: unknown;
        args?: unknown[];
      };
      const mapped = state.registry.getValue(address, functionName, fnArgs ?? []);
      if (mapped !== undefined) {
        return {
          result: mapped as any,
          request: {
            address,
            abi,
            functionName,
            args: fnArgs,
            value,
            account,
          },
        };
      }
      return {
        result: '0x',
        request: {
          address,
          abi,
          functionName,
          args: fnArgs,
          value,
          account,
        },
      };
    },
    async estimateGas(args: unknown) {
      state.lastArgs = args;
      const val = state.estimateGasValue;
      if (val instanceof Error) throw val;
      if (typeof val === 'bigint') return val;
      return 100_000n;
    },
    async estimateFeesPerGas() {
      return {
        maxFeePerGas: state.fees?.maxFeePerGas ?? 5n,
        maxPriorityFeePerGas: state.fees?.maxPriorityFeePerGas ?? 1n,
        gasPrice: state.gasPrice ?? state.fees?.maxFeePerGas ?? 5n,
      } as any;
    },
    async getGasPrice() {
      return state.gasPrice ?? 5n;
    },
    async getChainId() {
      return state.chainId ?? 324n;
    },
    async getCode({ address }: { address: Address }) {
      const key = lower(address);
      if (state.code) return state.code;
      // Default to deployed bytecode sentinel
      return key ? '0x01' : '0x';
    },
  } as unknown as PublicClient;
}

function makeWallet(account: Account): WalletClient<Transport, any, Account> {
  return {
    account,
    transport: { type: 'mock', value: {} },
  } as unknown as WalletClient<Transport, any, Account>;
}

function seedDefaults(registry: CallRegistry, baseToken: Address) {
  registry.set(
    ADAPTER_TEST_ADDRESSES.bridgehub,
    IBridgehub,
    'assetRouter',
    ADAPTER_TEST_ADDRESSES.l1AssetRouter,
  );
  registry.set(
    ADAPTER_TEST_ADDRESSES.l1AssetRouter,
    IL1AssetRouter,
    'L1_NULLIFIER',
    ADAPTER_TEST_ADDRESSES.l1Nullifier,
  );
  registry.set(
    ADAPTER_TEST_ADDRESSES.l1Nullifier,
    IL1Nullifier,
    'l1NativeTokenVault',
    ADAPTER_TEST_ADDRESSES.l1NativeTokenVault,
  );
  registry.set(ADAPTER_TEST_ADDRESSES.bridgehub, IBridgehub, 'baseToken', baseToken, [324n]);
}

export function createEthersHarness(opts: BaseOpts = {}): EthersHarness {
  const registry = new CallRegistry();
  if (opts.seed !== false) {
    seedDefaults(registry, opts.baseToken ?? ADAPTER_TEST_ADDRESSES.baseTokenFor324);
  }

  const state: EthersL1State = { registry };
  const l1 = makeEthersL1(state);
  const l2State: EthersL2State = { bridgehub: ADAPTER_TEST_ADDRESSES.bridgehub, registry };
  const l2 = makeEthersL2(l2State);
  const signer = makeSigner(l1, ADAPTER_TEST_ADDRESSES.signer);

  const client = createEthersClient({
    l1: l1 as any,
    l2: l2 as any,
    signer,
    overrides: opts.overrides as Partial<EthersResolvedAddresses> | undefined,
  });

  return {
    kind: 'ethers',
    client,
    l1,
    l2,
    signer,
    registry,
    setEstimateGas(value) {
      state.estimateGasValue = value;
    },
    onEstimateGas(cb) {
      state.estimateGasSpy = cb;
    },
    setL2EstimateGas(value) {
      l2State.estimateGasValue = value;
    },
    onL2EstimateGas(cb) {
      l2State.estimateGasSpy = cb;
    },
  };
}

export function createViemHarness(opts: BaseOpts = {}): ViemHarness {
  const registry = new CallRegistry();
  if (opts.seed !== false) {
    seedDefaults(registry, opts.baseToken ?? ADAPTER_TEST_ADDRESSES.baseTokenFor324);
  }

  const l1State: ViemClientState = { registry, bridgehub: ADAPTER_TEST_ADDRESSES.bridgehub };
  const l2State: ViemClientState = { registry, bridgehub: ADAPTER_TEST_ADDRESSES.bridgehub };

  const l1 = makeViemClient(l1State);
  const l2 = makeViemClient(l2State);

  const account = ADAPTER_TEST_ADDRESSES.signer as unknown as Account;
  const l1Wallet = makeWallet(account);
  const l2Wallet = makeWallet(account);

  const client = createViemClient({
    l1,
    l2,
    l1Wallet,
    l2Wallet,
    overrides: opts.overrides as Partial<ViemResolvedAddresses> | undefined,
  });

  return {
    kind: 'viem',
    client,
    l1,
    l2,
    l1Wallet,
    l2Wallet,
    registry,
    setSimulateResponse(value, target = 'l1') {
      const state = target === 'l1' ? l1State : l2State;
      state.simulateResponse = value as SimulateResponder | undefined;
    },
    setSimulateError(error, target = 'l1') {
      const state = target === 'l1' ? l1State : l2State;
      state.simulateError = error;
    },
    lastSimulateArgs(target = 'l1') {
      const state = target === 'l1' ? l1State : l2State;
      return state.lastArgs;
    },
    queueSimulateResponses(responses, target = 'l1') {
      const state = target === 'l1' ? l1State : l2State;
      state.simulateQueue = [...(state.simulateQueue ?? []), ...responses];
    },
    setEstimateGas(value, target = 'l1') {
      const state = target === 'l1' ? l1State : l2State;
      state.estimateGasValue = value;
    },
  };
}

export type DepositTestContext<T extends AdapterHarness> = {
  client: T['client'];
  sender: Address;
  chainIdL2: bigint;
  bridgehub: Address;
  l1AssetRouter: Address;
  l2GasLimit: bigint;
  gasPerPubdata: bigint;
  refundRecipient: Address;
  operatorTip: bigint;
  fee: {
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    gasPrice?: bigint;
    gasPriceForBaseCost: bigint;
  };
} & Record<string, unknown>;

export function makeDepositContext<T extends AdapterHarness>(
  harness: T,
  extras: Partial<DepositTestContext<T>> = {},
): DepositTestContext<T> {
  const baseFee = {
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    gasPriceForBaseCost: 5n,
  };

  const baseCtx: DepositTestContext<T> = {
    client: harness.client as DepositTestContext<T>['client'],
    sender: ADAPTER_TEST_ADDRESSES.signer,
    chainIdL2: 324n,
    bridgehub: ADAPTER_TEST_ADDRESSES.bridgehub,
    l1AssetRouter: ADAPTER_TEST_ADDRESSES.l1AssetRouter,
    l2GasLimit: 600_000n,
    gasPerPubdata: 800n,
    refundRecipient: ADAPTER_TEST_ADDRESSES.signer,
    operatorTip: 7n,
    fee: baseFee,
  };

  const merged = {
    ...baseCtx,
    ...extras,
    fee: {
      ...baseFee,
      ...(extras.fee ?? {}),
    },
  } as DepositTestContext<T>;

  return merged;
}

export type WithdrawalTestContext<T extends AdapterHarness> = {
  client: T['client'];
  sender: Address;
  chainIdL2: bigint;
  bridgehub: Address;
  l1AssetRouter: Address;
  l1Nullifier: Address;
  l2AssetRouter: Address;
  l2NativeTokenVault: Address;
  l2BaseTokenSystem: Address;
  baseIsEth: boolean;
  l2GasLimit: bigint;
  gasBufferPct: number;
  fee?: Record<string, unknown>;
} & Record<string, unknown>;

export function makeWithdrawalContext<T extends AdapterHarness>(
  harness: T,
  extras: Partial<WithdrawalTestContext<T>> = {},
): WithdrawalTestContext<T> {
  const baseCtx: WithdrawalTestContext<T> = {
    client: harness.client as WithdrawalTestContext<T>['client'],
    sender: ADAPTER_TEST_ADDRESSES.signer,
    chainIdL2: 324n,
    bridgehub: ADAPTER_TEST_ADDRESSES.bridgehub,
    l1AssetRouter: ADAPTER_TEST_ADDRESSES.l1AssetRouter,
    l1Nullifier: ADAPTER_TEST_ADDRESSES.l1Nullifier,
    l2AssetRouter: L2_ASSET_ROUTER_ADDRESS,
    l2NativeTokenVault: L2_NATIVE_TOKEN_VAULT_ADDRESS,
    l2BaseTokenSystem: L2_BASE_TOKEN_ADDRESS,
    baseIsEth: true,
    l2GasLimit: 300_000n,
    gasBufferPct: 15,
    fee: { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
  };

  return {
    ...baseCtx,
    ...extras,
    fee: {
      ...(baseCtx.fee ?? {}),
      ...(extras.fee ?? {}),
    },
  } as WithdrawalTestContext<T>;
}

type BaseCostCtx<T extends AdapterHarness> = Pick<
  DepositTestContext<T>,
  'chainIdL2' | 'fee' | 'l2GasLimit' | 'gasPerPubdata'
>;

type BaseCostOverrides = Partial<{
  chainIdL2: bigint;
  gasPriceForBaseCost: bigint;
  l2GasLimit: bigint;
  gasPerPubdata: bigint;
}>;

export function setBridgehubBaseCost<T extends AdapterHarness>(
  harness: T,
  ctx: BaseCostCtx<T>,
  value: bigint,
  overrides: BaseCostOverrides = {},
) {
  const chainId = overrides.chainIdL2 ?? ctx.chainIdL2;
  const gasPrice = overrides.gasPriceForBaseCost ?? ctx.fee.gasPriceForBaseCost;
  const l2Gas = overrides.l2GasLimit ?? ctx.l2GasLimit;
  const gasPerPubdata = overrides.gasPerPubdata ?? ctx.gasPerPubdata;

  harness.registry.set(
    ADAPTER_TEST_ADDRESSES.bridgehub,
    IBridgehub,
    'l2TransactionBaseCost',
    value,
    [chainId, gasPrice, l2Gas, gasPerPubdata],
  );
}

export function setBridgehubBaseToken<T extends AdapterHarness>(
  harness: T,
  ctx: { chainIdL2: bigint },
  value: Address,
) {
  harness.registry.set(ADAPTER_TEST_ADDRESSES.bridgehub, IBridgehub, 'baseToken', value, [
    ctx.chainIdL2,
  ]);
}

export function setErc20Allowance<T extends AdapterHarness>(
  harness: T,
  token: Address,
  owner: Address,
  spender: Address,
  value: bigint,
) {
  harness.registry.set(token, IERC20, 'allowance', value, [owner, spender]);
}

export function setL2TokenRegistration<T extends AdapterHarness>(
  harness: T,
  vault: Address,
  token: Address,
  assetId: `0x${string}`,
) {
  harness.registry.set(vault, L2NativeTokenVault, 'ensureTokenIsRegistered', assetId, [token]);
}

export function createAdapterHarness(kind: 'ethers', opts?: BaseOpts): EthersHarness;
export function createAdapterHarness(kind: 'viem', opts?: BaseOpts): ViemHarness;
export function createAdapterHarness(kind: 'ethers' | 'viem', opts: BaseOpts = {}): AdapterHarness {
  return kind === 'ethers' ? createEthersHarness(opts) : createViemHarness(opts);
}

export function adapterHarnessMatrix(kinds: Array<'ethers' | 'viem'> = ['ethers', 'viem']) {
  return kinds.map((kind) => createAdapterHarness(kind));
}

type AdapterKind = 'ethers' | 'viem';
type AdapterCallback<T> = (
  kind: AdapterKind,
  harnessFactory: (opts?: BaseOpts) => AdapterHarness,
) => void;

export function describeForAdapters(
  label: string,
  cb: AdapterCallback<AdapterHarness>,
  kinds: AdapterKind[] = ['ethers', 'viem'],
) {
  for (const kind of kinds) {
    describe(`${label} (${kind})`, () => {
      const factory = (opts?: BaseOpts) => createAdapterHarness(kind, opts);
      cb(kind, factory);
    });
  }
}
