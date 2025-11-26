import { Interface, AbiCoder } from 'ethers';

import {
  IBridgehubABI,
  IL2AssetRouterABI,
  IBaseTokenABI,
  IERC20ABI,
} from '../../core/abi.ts';

const Bridgehub = new Interface(IBridgehubABI as any);
const L2AssetRouter = new Interface(IL2AssetRouterABI as any);
const BaseToken = new Interface(IBaseTokenABI as any);
const IERC20 = new Interface(IERC20ABI as any);
const coder = new AbiCoder();

export function decodeTwoBridgeOuter(data: string) {
  const [outer] = Bridgehub.decodeFunctionData('requestL2TransactionTwoBridges', data) as any[];
  return outer;
}

export function decodeDirectRequest(data: string) {
  const [req] = Bridgehub.decodeFunctionData('requestL2TransactionDirect', data) as any[];
  return req;
}

export function decodeSecondBridgeErc20(calldata: string) {
  const [token, amount, receiver] = coder.decode(['address', 'uint256', 'address'], calldata);
  return {
    token: (token as string).toLowerCase(),
    amount: BigInt(amount),
    receiver: (receiver as string).toLowerCase(),
  };
}

export function decodeAssetRouterWithdraw(data: string) {
  const [assetId, assetData] = L2AssetRouter.decodeFunctionData('withdraw(bytes32,bytes)', data);
  const [amount, receiver, token] = coder.decode(['uint256', 'address', 'address'], assetData);
  return {
    assetId: assetId as `0x${string}`,
    amount: BigInt(amount),
    receiver: (receiver as string).toLowerCase(),
    token: (token as string).toLowerCase(),
  };
}

export function decodeBaseTokenWithdraw(data: string) {
  const [to] = BaseToken.decodeFunctionData('withdraw', data);
  return (to as string).toLowerCase();
}

type AdapterKind = 'ethers' | 'viem';

export function parseDirectBridgeTx(kind: AdapterKind, tx: any) {
  if (kind === 'ethers') {
    const req = decodeDirectRequest(tx.data) as any;
    return {
      to: (tx.to as string | undefined)?.toLowerCase(),
      from: (tx.from as string | undefined)?.toLowerCase(),
      value: BigInt((tx.value as bigint | undefined) ?? 0n),
      l2Contract: (req.l2Contract as string | undefined)?.toLowerCase() ?? '',
      l2Value: BigInt((req.l2Value as bigint | undefined) ?? 0n),
      mintValue: BigInt((req.mintValue as bigint | undefined) ?? 0n),
      l2GasLimit: BigInt((req.l2GasLimit as bigint | undefined) ?? 0n),
      refundRecipient: (req.refundRecipient as string | undefined)?.toLowerCase() ?? '',
      gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
    };
  }
  const viemTx = tx;
  const req = (viemTx.args?.[0] ?? {}) as any;
  return {
    to: (viemTx.address as string | undefined)?.toLowerCase?.(),
    from: (viemTx.account as string | undefined)?.toLowerCase?.(),
    value: BigInt((viemTx.value as bigint | undefined) ?? 0n),
    l2Contract: (req.l2Contract as string | undefined)?.toLowerCase() ?? '',
    l2Value: BigInt((req.l2Value as bigint | undefined) ?? 0n),
    mintValue: BigInt((req.mintValue as bigint | undefined) ?? 0n),
    l2GasLimit: BigInt((req.l2GasLimit as bigint | undefined) ?? 0n),
    refundRecipient: (req.refundRecipient as string | undefined)?.toLowerCase() ?? '',
    gasLimit: undefined,
  };
}

export function parseApproveTx(kind: AdapterKind, tx: any) {
  if (kind === 'ethers') {
    const decoded = IERC20.decodeFunctionData('approve', tx.data as string);
    return {
      to: (tx.to as string | undefined)?.toLowerCase(),
      spender: (decoded[0] as string | undefined)?.toLowerCase(),
      amount: BigInt((decoded[1] as bigint | undefined) ?? 0n),
    };
  }
  const viemTx = tx;
  const args = (viemTx.args ?? []) as unknown[];
  return {
    to: (viemTx.address as string | undefined)?.toLowerCase?.(),
    spender: (args[0] as string | undefined)?.toLowerCase() ?? '',
    amount: BigInt((args[1] as bigint | undefined) ?? 0n),
  };
}
