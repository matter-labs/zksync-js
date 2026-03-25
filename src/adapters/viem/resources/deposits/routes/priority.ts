import { encodeAbiParameters, type Hex } from 'viem';

import type { Address } from '../../../../../core/types/primitives';

const EMPTY_BYTES = '0x' as Hex;
const ZERO_RESERVED_WORDS = [0n, 0n, 0n, 0n] as const;
const L2_CANONICAL_TRANSACTION_PARAMETER = {
  type: 'tuple',
  components: [
    { name: 'txType', type: 'uint256' },
    { name: 'from', type: 'uint256' },
    { name: 'to', type: 'uint256' },
    { name: 'gasLimit', type: 'uint256' },
    { name: 'gasPerPubdataByteLimit', type: 'uint256' },
    { name: 'maxFeePerGas', type: 'uint256' },
    { name: 'maxPriorityFeePerGas', type: 'uint256' },
    { name: 'paymaster', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'value', type: 'uint256' },
    { name: 'reserved', type: 'uint256[4]' },
    { name: 'data', type: 'bytes' },
    { name: 'signature', type: 'bytes' },
    { name: 'factoryDeps', type: 'uint256[]' },
    { name: 'paymasterInput', type: 'bytes' },
    { name: 'reservedDynamic', type: 'bytes' },
  ],
} as const;

function hexByteLength(hex: Hex): bigint {
  return BigInt(Math.max(hex.length - 2, 0) / 2);
}

// Mailbox validates priority requests using `abi.encode(L2CanonicalTransaction)`,
// so route quoting mirrors that exact tuple shape instead of approximating a fixed size.
export function getPriorityTxEncodedLength(input: {
  sender: Address;
  l2Contract: Address;
  l2Value: bigint;
  l2Calldata: Hex;
  gasPerPubdata: bigint;
  factoryDepsHashes?: bigint[];
}): bigint {
  const encoded = encodeAbiParameters(
    [L2_CANONICAL_TRANSACTION_PARAMETER],
    [
      {
        txType: 0n,
        from: BigInt(input.sender),
        to: BigInt(input.l2Contract),
        gasLimit: 0n,
        gasPerPubdataByteLimit: input.gasPerPubdata,
        maxFeePerGas: 0n,
        maxPriorityFeePerGas: 0n,
        paymaster: 0n,
        nonce: 0n,
        value: input.l2Value,
        reserved: ZERO_RESERVED_WORDS,
        data: input.l2Calldata,
        signature: EMPTY_BYTES,
        factoryDeps: input.factoryDepsHashes ?? [],
        paymasterInput: EMPTY_BYTES,
        reservedDynamic: EMPTY_BYTES,
      },
    ],
  );

  return hexByteLength(encoded);
}
