import type {
  Abi,
  Account,
  Chain,
  EstimateContractGasParameters,
  PublicClient,
  TransactionReceipt,
  Transport,
  WalletClient,
  WriteContractParameters,
} from 'viem';

import type {
  SourceExecutionDriver,
  SourceExecutionStepContext,
} from '../../../core/internal/cross-chain/execution';
import type { PlanStep } from '../../../core/types/flows/base';
import type { TxOverrides } from '../../../core/types/fees';
import type { Address, Hex } from '../../../core/types/primitives';

type ViemWallet = WalletClient<Transport, Chain, Account>;

interface FeeRequest {
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

interface ContractRequest extends FeeRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  account?: Account | Address;
  chain?: Chain | null;
  dataSuffix?: Hex;
  value?: bigint;
}

interface RawRequest extends FeeRequest {
  to?: Address;
  data?: Hex;
  value?: bigint;
  gasLimit?: bigint;
}

interface StepContext<Tx> {
  step: PlanStep<Tx>;
  request: Tx;
  nonce: number;
  account: Account;
  txHash?: Hex;
}

interface GasPolicy<Tx> {
  mode: 'always' | 'when-missing';
  resolveGasLimit(input: {
    step: PlanStep<Tx>;
    request: Tx;
    preparedGasLimit?: bigint;
    estimatedGasLimit: bigint;
  }): bigint | undefined;
}

interface DriverOptions<Tx extends FeeRequest> {
  publicClient: PublicClient;
  wallet?: ViemWallet;
  account: Account;
  nonceAddress?: Address;
  defaultNonceTag: 'latest' | 'pending';
  overrides?: TxOverrides;
  gasPolicy?: GasPolicy<Tx>;
  shouldSkip?(input: { step: PlanStep<Tx>; account: Account }): Promise<boolean>;
  missingWalletError(input: StepContext<Tx>): Error;
  revertedError(input: StepContext<Tx> & { txHash: Hex }): Error;
  mapError(error: unknown, input: StepContext<Tx>): Error;
}

interface DriverHooks<Tx extends FeeRequest> {
  prepare(context: SourceExecutionStepContext<Tx>): Tx;
  currentGas(request: Tx): bigint | undefined;
  preparedGas(step: PlanStep<Tx>): bigint | undefined;
  estimateGas(request: Tx): Promise<bigint>;
  send(wallet: ViemWallet, request: Tx, nonce: number): Promise<Hex>;
}

export function createViemContractWriteDriver<Tx extends ContractRequest>(
  options: DriverOptions<Tx>,
): SourceExecutionDriver<Tx, TransactionReceipt> {
  return createViemDriver(options, {
    prepare(context) {
      const request = {
        ...context.step.tx,
        account: context.step.tx.account ?? options.account,
        args: context.step.tx.args ?? [],
        nonce: context.nonce,
      } as Tx;
      applyOverrides(request, options.overrides);
      return request;
    },
    currentGas: (request) => request.gas,
    preparedGas: (step) => step.tx.gas,
    estimateGas: (request) => estimateContractGas(options.publicClient, request),
    send: (wallet, request) => wallet.writeContract(request as WriteContractParameters),
  });
}

export function createViemRawTransactionDriver<Tx extends RawRequest>(
  options: DriverOptions<Tx>,
): SourceExecutionDriver<Tx, TransactionReceipt> {
  return createViemDriver(options, {
    prepare(context) {
      const request = { ...context.step.tx };
      applyOverrides(request, options.overrides);
      return request;
    },
    currentGas: (request) => request.gas ?? request.gasLimit,
    preparedGas: (step) => step.tx.gas ?? step.tx.gasLimit,
    estimateGas: (request) =>
      options.publicClient.estimateGas({
        account: options.account,
        to: request.to,
        data: request.data,
        value: request.value,
      }),
    send: (wallet, request, nonce) =>
      wallet.sendTransaction({
        account: options.account,
        chain: null,
        to: request.to,
        data: request.data,
        value: request.value,
        gas: request.gas ?? request.gasLimit,
        maxFeePerGas: request.maxFeePerGas,
        maxPriorityFeePerGas: request.maxPriorityFeePerGas,
        nonce,
      }),
  });
}

function createViemDriver<Tx extends FeeRequest>(
  options: DriverOptions<Tx>,
  hooks: DriverHooks<Tx>,
): SourceExecutionDriver<Tx, TransactionReceipt> {
  return {
    resolveNonce: async (nonce) =>
      typeof nonce === 'number'
        ? nonce
        : options.publicClient.getTransactionCount({
            address: options.nonceAddress ?? options.account.address,
            blockTag: nonce ?? options.defaultNonceTag,
          }),
    async executeStep(context) {
      if (await options.shouldSkip?.({ step: context.step, account: options.account }))
        return { kind: 'skipped' };

      const request = hooks.prepare(context);
      if (
        options.gasPolicy &&
        options.overrides?.gasLimit == null &&
        (options.gasPolicy.mode === 'always' || hooks.currentGas(request) == null)
      ) {
        try {
          request.gas = options.gasPolicy.resolveGasLimit({
            step: context.step,
            request,
            preparedGasLimit: hooks.preparedGas(context.step),
            estimatedGasLimit: await hooks.estimateGas(request),
          });
        } catch {
          // Estimation is best-effort. Keep the prepared gas on the cloned request.
        }
      }

      let txHash: Hex | undefined;
      try {
        if (!options.wallet) {
          throw options.missingWalletError({ ...context, request, account: options.account });
        }
        txHash = await hooks.send(options.wallet, request, context.nonce);
        const receipt = await options.publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== 'success') {
          throw options.revertedError({
            ...context,
            request,
            account: options.account,
            txHash,
          });
        }
        return { kind: 'confirmed', hash: txHash, receipt };
      } catch (error) {
        throw options.mapError(error, {
          ...context,
          request,
          account: options.account,
          txHash,
        });
      }
    },
  };
}

function applyOverrides(request: FeeRequest, overrides: TxOverrides | undefined): void {
  if (overrides?.gasLimit != null) request.gas = overrides.gasLimit;
  if (overrides?.maxFeePerGas != null) request.maxFeePerGas = overrides.maxFeePerGas;
  if (overrides?.maxPriorityFeePerGas != null) {
    request.maxPriorityFeePerGas = overrides.maxPriorityFeePerGas;
  }
}

function estimateContractGas(client: PublicClient, request: ContractRequest): Promise<bigint> {
  return client.estimateContractGas({
    address: request.address,
    abi: request.abi,
    functionName: request.functionName,
    args: request.args ?? [],
    account: request.account,
    ...(request.value != null ? { value: request.value } : {}),
    ...(request.maxFeePerGas != null && request.maxPriorityFeePerGas != null
      ? {
          maxFeePerGas: request.maxFeePerGas,
          maxPriorityFeePerGas: request.maxPriorityFeePerGas,
        }
      : {}),
  } as EstimateContractGasParameters);
}
