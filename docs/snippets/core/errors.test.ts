// ANCHOR: error-import
import { isZKsyncError } from '../../../src/core/types/errors';
// ANCHOR_END: error-import

import { type ErrorEnvelope as Envelope, Resource, ErrorType } from '../../../src/core/types/errors';
import { Account, createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, createViemSdk, type ViemSdk } from '../../../src/adapters/viem';
import { beforeAll, describe, it } from 'bun:test';
import { l1Chain, l2Chain } from '../viem/chains';
import { ETH_ADDRESS } from '../../../src/core';
import type { Exact } from "./types";

// ANCHOR: envelope-type
export interface ErrorEnvelope {
  /** Resource surface that raised the error. */
  resource: Resource;
  /** SDK operation, e.g. 'withdrawals.finalize' */
  operation: string;
  /** Broad category */
  type: ErrorType;
  /** Human-readable, stable message for developers. */
  message: string;

  /** Optional detail that adapters may enrich (reverts, extra context) */
  context?: Record<string, unknown>;

  /** If the error is a contract revert, adapters add decoded info here. */
  revert?: {
    /** 4-byte selector as 0x…8 hex */
    selector: `0x${string}`;
    /** Decoded error name when available (e.g. 'InvalidProof') */
    name?: string;
    /** Decoded args (ethers/viem output), when available */
    args?: unknown[];
    /** Optional adapter-known labels */
    contract?: string;
    /** Optional adapter-known function name */
    fn?: string;
  };

  /** Original thrown error  */
  cause?: unknown;
}
// ANCHOR_END: envelope-type

describe('checks rpc docs examples', () => {

let sdk: ViemSdk;
let account: Account;
let params: any;

beforeAll(() => {
  account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

  const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
  const l2 = createPublicClient({ transport: http(process.env.L2_RPC!) });
  const l1Wallet = createWalletClient({ chain: l1Chain, account, transport: http(process.env.L1_RPC!) });
  const l2Wallet = createWalletClient({ chain: l2Chain, account, transport: http(process.env.L2_RPC!) });

  const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
  sdk = createViemSdk(client);

  params = {
    amount: parseEther('0.01'),
    to: account.address,
    token: ETH_ADDRESS,
} as const;
})

// this test will always succeed
// but any errors will be highlighted
it('checks to see if the error types are updated', async () => {
    const _envelopeType: Exact<ErrorEnvelope, Envelope> = true;
});

it('shows how to handle errors', async () => {
// ANCHOR: zksync-error
try {
  const handle = await sdk.deposits.create(params);
} catch (e) {
  if (isZKsyncError(e)) {
    const err = e; // type-narrowed
    const { type, resource, operation, message, context, revert } = err.envelope;

    switch (type) {
      case 'VALIDATION':
      case 'STATE':
        // user/action fixable (bad input, not-ready, etc.)
        break;
      case 'EXECUTION':
      case 'RPC':
        // network/tx/provider issues
        break;
    }

    console.error(JSON.stringify(err.toJSON())); // structured log
  } else {
    throw e; // non-SDK error
  }
}
// ANCHOR_END: zksync-error
})

it('handles a withdrawal error', async () => {
// ANCHOR: try-create
const res = await sdk.withdrawals.tryCreate(params);
if (!res.ok) {
    if (isZKsyncError(res.error)) {
    // res.error is a ZKsyncError
    console.warn(res.error.envelope.message, res.error.envelope.operation);
  } else {
    throw new Error("Unkown error");
  }
} else {
  console.log('l2TxHash', res.value.l2TxHash);
}
// ANCHOR_END: try-create

if(!res.ok) throw new Error("response not ok");
const l2TxHash = res.value.l2TxHash;

// ANCHOR: revert-details
try {
  await sdk.withdrawals.finalize(l2TxHash);
} catch (e) {
  if (isZKsyncError(e) && e.envelope.revert) {
    const { selector, name, args } = e.envelope.revert;
    // e.g., name === 'InvalidProof' or 'TransferAmountExceedsBalance'
  }
}
// ANCHOR_END: revert-details
})

it('handles a deposit error', async () => {
// ANCHOR: envelope-error
const res = await sdk.deposits.tryCreate(params);
if (!res.ok) {
    if (isZKsyncError(res.error)) console.error(res.error.envelope); // structured envelope
}
// ANCHOR_END: envelope-error
})

});