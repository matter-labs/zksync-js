# Choosing Your Adapter: `viem` vs. `ethers`

The SDK is designed to work with both `viem` and `ethers.js`, the two most popular Ethereum libraries. Since the SDK offers **identical functionality** for both, the choice comes down to your project's needs and your personal preference.

## The Short Answer (TL;DR)

- **If you're adding the SDK to an existing project:** Use the adapter for the library you're already using.
- **If you're starting a new project:** The choice is yours. `viem` is generally recommended for new projects due to its modern design, smaller bundle size, and excellent TypeScript support.

You can't make a wrong choice. Both adapters are fully supported and provide the same features.

## Code Comparison

The only difference in your code is the initial setup. **All subsequent SDK calls are identical.**

### viem

```ts
{{#include ../../snippets/viem/overview/adapter-basic.test.ts:viem-basic-imports}}

{{#include ../../snippets/viem/overview/adapter-basic.test.ts:init-viem-adapter}}
```

### ethers

```ts
{{#include ../../snippets/ethers/overview/adapter-basic.test.ts:ethers-basic-imports}}

{{#include ../../snippets/ethers/overview/adapter-basic.test.ts:init-ethers-adapter}}
```

## Identical SDK Usage

Once the adapter is set up, **your application logic is the same**:

```ts
{{#include ../../snippets/viem/overview/adapter.test.ts:deposit-quote}}
```

## Conclusion

The adapter model is designed to give you flexibility without adding complexity. Your choice of adapter is a low-stakes decision that's easy to change later.

**Ready to start building?** 🚀

- [**Go to Quickstart (viem)**](./viem.md)
- [**Go to Quickstart (ethers)**](./ethers.md)
