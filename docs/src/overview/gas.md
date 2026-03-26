# Gas & Fees

This page explains how `zksync-js` quotes deposit gas and fees.

## Source Of Truth

The protocol constants and validator rules used by the SDK come from `era-contracts`:

- [`Config.sol`](https://github.com/matter-labs/era-contracts/blob/main/l1-contracts/contracts/common/Config.sol)
- [`Mailbox.sol`](https://github.com/matter-labs/era-contracts/blob/main/l1-contracts/contracts/state-transition/chain-deps/facets/Mailbox.sol)
- [`TransactionValidator.sol`](https://github.com/matter-labs/era-contracts/blob/main/l1-contracts/contracts/state-transition/libraries/TransactionValidator.sol)
- [`L1AssetRouter.sol`](https://github.com/matter-labs/era-contracts/blob/main/l1-contracts/contracts/bridge/asset-router/L1AssetRouter.sol)
- [`NativeTokenVault.sol`](https://github.com/matter-labs/era-contracts/blob/main/l2-contracts/contracts/bridge/NativeTokenVault.sol)

The SDK mirrors those constants in code, but the contracts above are the protocol source of truth.

## Deposit Quotes

Deposit quotes are conservative caps, not realized post-execution charges.

- `fees.l2.gasLimit` is the quoted L2 execution budget used to price the priority transaction.
- `fees.l2.baseCost` is the result of `Bridgehub.l2TransactionBaseCost(...)` for that budget.
- `fees.l2.total = fees.l2.baseCost + operatorTip`.
- `fees.maxTotal = fees.l1.maxTotal + fees.l2.total`.
- `fees.mintValue` is the amount funded into the Bridgehub request. For direct base-token deposits, it includes the transferred L2 value as well as the quoted L2 fee reserve.

That means explorer `gasUsed` and realized L2 fee can be lower than the quote.

## Deposits

### Direct Deposits: `eth-base` and `erc20-base`

Direct deposits use the exact canonical priority-transaction encoding and the validator floor from `TransactionValidator`.

The SDK computes the exact `abi.encode(L2CanonicalTransaction)` length for the direct request shape, then applies:

```typescript
minBodyGas =
  max(
    L1_TX_INTRINSIC_L2_GAS +
      ceilDiv(encodedLength * L1_TX_DELTA_544_ENCODING_BYTES, 544),
    L1_TX_MIN_L2_GAS_BASE,
  ) +
  L1_TX_INTRINSIC_PUBDATA * gasPerPubdata

overhead =
  max(
    TX_SLOT_OVERHEAD_L2_GAS,
    MEMORY_OVERHEAD_GAS * encodedLength,
  )

l2GasLimit = minBodyGas + overhead
```

This is the quoted cap for direct deposits unless the caller explicitly overrides `l2GasLimit`.

### Two-Bridges Asset-Router Deposits: `erc20-nonbase` and `eth-nonbase`

For non-base asset-router deposits, the quote depends on whether the bridged asset is already deployed on L2.

#### Deployed Token Path

When the bridged asset already exists on L2, the SDK asks `L1AssetRouter.getDepositCalldata(...)` for the exact L2 finalize-deposit calldata, computes the exact canonical priority-transaction encoding length, and applies the same validator-floor formula shown above.

This keeps the quote asset-specific because calldata length depends on the actual bridge payload.

#### First Deployment Path

For undeployed `erc20-nonbase` and `eth-nonbase` deposits, exact deployment-path estimates can fluctuate across environments and underquote the real L2 execution. The SDK therefore uses a calibrated dynamic cap derived from the validator floor instead of trusting the exact estimate:

```typescript
bodyGas = minBodyGas * 6
l2GasLimit = bodyGas + overhead
```

This still scales with the exact calldata length and `gasPerPubdata`, but avoids environment-specific low estimates on first deployment.

## Base Cost Pricing

After the route chooses `l2GasLimit`, the SDK prices it with:

```text
baseCost = Bridgehub.l2TransactionBaseCost(
  chainId,
  l1GasPrice,
  l2GasLimit,
  gasPerPubdata,
)
```

So the gas-limit model and the gas-price model are separate:

- `l2GasLimit` is the execution budget.
- `l1GasPrice` and `gasPerPubdata` determine how that budget is priced.

## Manual Overrides

If you pass `l2GasLimit`, the SDK uses your override instead of the route-specific model.

This is useful for controlled environments, but for general-purpose quoting the built-in route models are safer because they align with the current deposit path and protocol validator rules.
