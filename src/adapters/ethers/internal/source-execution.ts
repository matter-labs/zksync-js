import type { AbstractProvider, Signer, TransactionReceipt, TransactionRequest } from 'ethers';

import type {
  SourceExecutionDriver,
  SourceExecutionStepContext,
} from '../../../core/internal/cross-chain/execution';
import type { PlanStep } from '../../../core/types/flows/base';
import type { TxOverrides } from '../../../core/types/fees';
import type { Address, Hex } from '../../../core/types/primitives';

export interface EthersSourceStepContext {
  step: PlanStep<TransactionRequest>;
  request: TransactionRequest;
  nonce: number;
  sender: Address;
  txHash?: Hex;
}

export interface EthersGasPolicy {
  mode: 'always' | 'when-missing';
  estimateFrom?: Address;
  resolveGasLimit(input: {
    step: PlanStep<TransactionRequest>;
    request: TransactionRequest;
    preparedGasLimit?: bigint;
    estimatedGasLimit: bigint;
  }): bigint | undefined;
}

export interface EthersTransactionDriverOptions {
  provider: AbstractProvider;
  signer: Signer;
  defaultNonceTag: 'latest' | 'pending';
  overrides?: TxOverrides;
  requestDefaults?: TransactionRequest;
  /** Preserve the prior ethers pending-nonce synchronization while using the core-assigned nonce. */
  synchronizePendingNonce?: boolean;
  gasPolicy?: EthersGasPolicy;
  shouldSkip?(input: { step: PlanStep<TransactionRequest>; sender: Address }): Promise<boolean>;
  revertedError(input: EthersSourceStepContext & { txHash: Hex }): Error;
  mapError(error: unknown, input: EthersSourceStepContext): Error;
}

export function createEthersTransactionDriver(
  options: EthersTransactionDriverOptions,
): SourceExecutionDriver<TransactionRequest, TransactionReceipt> {
  let senderPromise: Promise<Address> | undefined;
  let pendingNonceSynchronized = false;
  const getSender = () =>
    (senderPromise ??= options.signer.getAddress().then((address) => address as Address));

  return {
    async resolveNonce(nonce) {
      if (typeof nonce === 'number') return nonce;
      return options.provider.getTransactionCount(
        await getSender(),
        nonce ?? options.defaultNonceTag,
      );
    },
    async executeStep(context) {
      const sender = await getSender();
      if (await options.shouldSkip?.({ step: context.step, sender })) return { kind: 'skipped' };

      const request = prepareRequest(context, options.requestDefaults, options.overrides);
      await resolveGasLimit(
        context.step,
        request,
        options.provider,
        options.gasPolicy,
        options.overrides,
      );

      let txHash: Hex | undefined;
      try {
        if (options.synchronizePendingNonce && !pendingNonceSynchronized) {
          await options.provider.getTransactionCount(sender, 'pending');
          pendingNonceSynchronized = true;
        }
        const sent = await options.signer.sendTransaction(request);
        txHash = sent.hash as Hex;
        const receipt = await sent.wait();
        if (!receipt || receipt.status === 0) {
          throw options.revertedError({ ...context, request, sender, txHash });
        }
        return { kind: 'confirmed', hash: txHash, receipt };
      } catch (error) {
        throw options.mapError(error, { ...context, request, sender, txHash });
      }
    },
  };
}

function prepareRequest(
  context: SourceExecutionStepContext<TransactionRequest>,
  defaults: TransactionRequest | undefined,
  overrides: TxOverrides | undefined,
): TransactionRequest {
  const request: TransactionRequest = {
    ...defaults,
    ...context.step.tx,
    nonce: context.nonce,
  };
  if (overrides?.gasLimit != null) request.gasLimit = overrides.gasLimit;
  if (overrides?.maxFeePerGas != null) request.maxFeePerGas = overrides.maxFeePerGas;
  if (overrides?.maxPriorityFeePerGas != null) {
    request.maxPriorityFeePerGas = overrides.maxPriorityFeePerGas;
  }
  return request;
}

async function resolveGasLimit(
  step: PlanStep<TransactionRequest>,
  request: TransactionRequest,
  provider: AbstractProvider,
  policy: EthersGasPolicy | undefined,
  overrides: TxOverrides | undefined,
): Promise<void> {
  if (!policy || overrides?.gasLimit != null) return;
  if (policy.mode === 'when-missing' && request.gasLimit != null) return;

  const preparedGasLimit = toBigInt(step.tx.gasLimit);
  try {
    const estimatedGasLimit = BigInt(
      await provider.estimateGas(
        policy.estimateFrom == null ? request : { ...request, from: policy.estimateFrom },
      ),
    );
    request.gasLimit = policy.resolveGasLimit({
      step,
      request,
      preparedGasLimit,
      estimatedGasLimit,
    });
  } catch {
    // Estimation is best-effort. The prepared gas limit remains on the cloned request.
  }
}

function toBigInt(value: TransactionRequest['gasLimit']): bigint | undefined {
  return value == null ? undefined : BigInt(value.toString());
}
