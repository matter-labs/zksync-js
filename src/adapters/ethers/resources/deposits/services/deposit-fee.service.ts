import type { Contract } from 'ethers';
import type { createErrorHandlers } from '../../../errors/error-ops';

type WrapAsFn = ReturnType<typeof createErrorHandlers>['wrapAs'];

type BaseCostArgs = {
  bridgehub: Contract;
  op: string;
  wrapAs: WrapAsFn;
  chainIdL2: bigint;
  gasPriceForBaseCost: bigint;
  l2GasLimit: bigint;
  gasPerPubdata: bigint;
};

// Computes l2TransactionBaseCost via Bridgehub with consistent error handling.
export async function computeBaseCost({
  bridgehub,
  op,
  wrapAs,
  chainIdL2,
  gasPriceForBaseCost,
  l2GasLimit,
  gasPerPubdata,
}: BaseCostArgs): Promise<bigint> {
  const raw = (await wrapAs(
    'RPC',
    op,
    () =>
      bridgehub.l2TransactionBaseCost(chainIdL2, gasPriceForBaseCost, l2GasLimit, gasPerPubdata),
    {
      ctx: { where: 'l2TransactionBaseCost', chainIdL2 },
      message: 'Could not fetch L2 base cost from Bridgehub.',
    },
  )) as bigint;
  return BigInt(raw);
}
