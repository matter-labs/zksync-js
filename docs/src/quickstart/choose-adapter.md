# Choosing Your Adapter: `viem` vs. `ethers`

The SDK is designed to work with both `viem` and `ethers.js`, the two most popular Ethereum libraries. Since the SDK offers **identical functionality** for both, the choice comes down to your project's needs and your personal preference.

## The Short Answer (TL;DR)

- **If you're adding the SDK to an existing project:** Use the adapter for the library you're already using.
- **If you're starting a new project:** The choice is yours. `viem` is generally recommended for new projects due to its modern design, smaller bundle size, and excellent TypeScript support.

You can't make a wrong choice. Both adapters are fully supported and provide the same features.

## Code Comparison

The only difference in your code is the initial setup. **All subsequent SDK calls are identical.**

#### viem

```ts
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient, createViemSdk } from '@matter-labs/zksync-js/viem';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const l1 = createPublicClient({ transport: http(process.env.L1_RPC!) });
const l2 = createPublicClient({ transport: http(process.env.L2_RPC!) });
const l1Wallet = createWalletClient({ account, transport: http(process.env.L1_RPC!) });

const client = createViemClient({ l1, l2, l1Wallet });
const sdk = createViemSdk(client);
```

#### ethers

```ts
import { JsonRpcProvider, Wallet } from 'ethers';
import { createEthersClient, createEthersSdk } from '@matter-labs/zksync-js/ethers';

const l1 = new JsonRpcProvider(process.env.L1_RPC!);
const l2 = new JsonRpcProvider(process.env.L2_RPC!);
const signer = new Wallet(process.env.PRIVATE_KEY!, l1);

const client = await createEthersClient({ l1, l2, signer });
const sdk = createEthersSdk(client);
```

### Identical SDK Usage

Once the adapter is set up, **your application logic is the same**:

```ts
const quote = await sdk.deposits.quote({
  token: ETH_ADDRESS,
  amount: parseEther('0.1'),
  to: '0xYourAddress',
});

console.log('Total fee:', quote.totalFee.toString());
```

## Conclusion

The adapter model is designed to give you flexibility without adding complexity. Your choice of adapter is a low-stakes decision that's easy to change later.

**Ready to start building?** 🚀

- [**Go to Quickstart (viem)**](./viem.md)
- [**Go to Quickstart (ethers)**](./ethers.md)
