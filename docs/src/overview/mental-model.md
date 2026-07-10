# Mental Model

The SDK is designed around predictable intent resources for L1-to-L2 deposits, L2-to-L1 withdrawals, and L2-to-L2 interop. They share sequencing, receipt handling, proof assembly, polling, timeout, and idempotency internally without exposing a generic cross-chain resource.

The complete lifecycle for any action is:

```bash
quote → prepare → create → status → wait → (finalize*)
```

- The first five steps are common to **Deposits**, **Withdrawals**, and **Interop**.
- Deposits complete automatically through the priority-transaction path.
- Withdrawals and interop add **`finalize`**, which atomically executes a bundle on L1 or the destination L2.

You can enter this lifecycle at different stages depending on how much control you need.

## The Core API: A Layered Approach

The core methods are designed to give you progressively more automation. You can start by just getting information (`quote`), move to building transactions without sending them (`prepare`), or execute the entire flow with a single call (`create`).

### `quote(params)`

_"What will this operation involve and cost?"_

This is a **read-only** dry run. It performs no transactions and has no side effects. It inspects the parameters and returns a `Quote` object containing the estimated fees, gas costs, and the steps the SDK will take to complete the action.

➡️ **Best for:** Displaying a confirmation screen to a user with a cost estimate before they commit.

### `prepare(params)`

_"Build the transactions for me, but let me send them."_

This method constructs all the necessary transactions for the operation and returns them as an array of `TransactionRequest` objects in a `Plan`. It does **not** sign or send them. This gives you full control over the final execution.

➡️ **Best for:** Custom workflows where you need to inspect transactions before signing, use a unique signing method, or submit them through a separate system (like a multisig).

### `create(params)`

_"Prepare, sign, and send in one go."_

This is the most common entry point for a one-shot operation. It internally calls `prepare`, then uses your configured signer to sign and dispatch the transactions. It returns a `Handle` object, which is a lightweight tracker containing the transaction hash(es) needed for the next steps.

➡️ **Best for:** Most standard use cases where you simply want to initiate the deposit or withdrawal.

### `status(handle | txHash)`

_"Where is my transaction right now?"_

This is a **non-blocking** check to get the current state of an operation. It takes a `Handle` from the `create` method or a transaction hash and returns a structured status object, such as:

- **Deposits:** `{ phase: 'L1_PENDING' | 'L2_EXECUTED' }`
- **Withdrawals:** `{ phase: 'L2_PENDING' | 'READY_TO_FINALIZE' | 'FINALIZING' | 'FINALIZED' }`
- **Interop:** `{ phase: 'SENT' | 'VERIFIED' | 'EXECUTED' }`

➡️ **Best for:** Polling in a UI to show a user the live progress of their transaction without blocking the interface.

### `wait(handle, { for })`

_"Pause until a specific checkpoint is reached."_

This is a **blocking** (asynchronous) method that polls for you. It pauses execution until the operation reaches a desired checkpoint and then resolves with the relevant transaction receipt.

- **Deposits:** Wait for L1 inclusion (`'l1'`) or L2 execution (`'l2'`).
- **Withdrawals:** Wait for L2 inclusion (`'l2'`), finalization availability (`'ready'`), or final L1 finalization (`'finalized'`).

➡️ **Best for:** Scripts or backend processes where you need to ensure one step is complete before starting the next.

### `finalize(l2TxHash)`

_(Withdrawals and Interop)_

_"My funds are ready on L1. Finalize and release them."_

For withdrawals, this method calls `L1InteropHandler.executeBundle` after `status` reports `READY_TO_FINALIZE`. For interop, it calls `executeBundle` on the destination L2. Both paths verify and execute the complete bundle atomically.

➡️ **Best for:** The final step of any withdrawal flow.

## Error Handling: The `try*` Philosophy

For more robust error handling without `try/catch` blocks, **every core method has a `try*` variant** (e.g., `tryQuote`, `tryCreate`).

Instead of throwing an error on failure, these methods return a result object that enforces explicit error handling:

```ts
{{#include ../../snippets/ethers/overview/adapter.test.ts:mental-model}}
```

➡️ **Best for:** Applications that prefer a functional error-handling pattern and want to avoid uncaught exceptions.

## Putting It All Together

These primitives allow you to compose flows that are as simple or as complex as you need.

#### Simple Flow

Use `create` and `wait` for the most straightforward path.

```ts
{{#include ../../snippets/ethers/overview/adapter.test.ts:simple-flow}}
```
