import { AbiCoder } from 'ethers';

import type { Address } from '../../../../../core/types/primitives';

const EMPTY_BYTES = '0x';
const ZERO_RESERVED_WORDS = [0n, 0n, 0n, 0n] as const;
const L2_CANONICAL_TRANSACTION_TUPLE =
  'tuple(uint256 txType,uint256 from,uint256 to,uint256 gasLimit,uint256 gasPerPubdataByteLimit,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,uint256 paymaster,uint256 nonce,uint256 value,uint256[4] reserved,bytes data,bytes signature,uint256[] factoryDeps,bytes paymasterInput,bytes reservedDynamic)';

function hexByteLength(hex: string): bigint {
  return BigInt(Math.max(hex.length - 2, 0) / 2);
}

// Mailbox validates priority requests using `abi.encode(L2CanonicalTransaction)`,
// so route quoting mirrors that exact tuple shape instead of approximating a fixed size.
export function getPriorityTxEncodedLength(input: {
  sender: Address;
  l2Contract: Address;
  l2Value: bigint;
  l2Calldata: `0x${string}`;
  gasPerPubdata: bigint;
  factoryDepsHashes?: bigint[];
}): bigint {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    [L2_CANONICAL_TRANSACTION_TUPLE],
    [
      [
        0n,
        BigInt(input.sender),
        BigInt(input.l2Contract),
        0n,
        input.gasPerPubdata,
        0n,
        0n,
        0n,
        0n,
        input.l2Value,
        ZERO_RESERVED_WORDS,
        input.l2Calldata,
        EMPTY_BYTES,
        input.factoryDepsHashes ?? [],
        EMPTY_BYTES,
        EMPTY_BYTES,
      ],
    ],
  );

  return hexByteLength(encoded);
}
