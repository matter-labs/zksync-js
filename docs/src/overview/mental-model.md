# Mental Model

The SDK is designed around a predictable and layered API for handling L1-L2, and L2-L1 operations. Every action, whether it's a deposit or a withdrawal, follows a consistent lifecycle. Understanding this lifecycle is key to using the SDK effectively.

The complete lifecycle for any action is:

```bash
quote → prepare → create → status → wait → (finalize*)
```

- The first five steps are common to both **Deposits** and **Withdrawals**.
- Withdrawals require an additional **`finalize`** step to prove and claim the funds on L1.

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
- **Withdrawals:** `{ phase: 'L1_INCLUDED','L2_PENDING' | 'READY_TO_FINALIZE' | 'FINALIZED' }`

➡️ **Best for:** Polling in a UI to show a user the live progress of their transaction without blocking the interface.

### `wait(handle, { for })`

_"Pause until a specific checkpoint is reached."_

This is a **blocking** (asynchronous) method that polls for you. It pauses execution until the operation reaches a desired checkpoint and then resolves with the relevant transaction receipt.

- **Deposits:** Wait for L1 inclusion (`'l1'`) or L2 execution (`'l2'`).
- **Withdrawals:** Wait for L2 inclusion (`'l2'`), finalization availability (`'ready'`), or final L1 finalization (`'finalized'`).

➡️ **Best for:** Scripts or backend processes where you need to ensure one step is complete before starting the next.

### `finalize(l2TxHash)`

_(Withdrawals Only)_

_"My funds are ready on L1. Finalize and release them."_

This method executes the final step of a withdrawal. After `status` reports `READY_TO_FINALIZE`, you call this method with the L2 transaction hash to submit the finalization transaction on L1, which releases the funds to the recipient.

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
