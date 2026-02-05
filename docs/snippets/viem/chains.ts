import { defineChain } from "viem";

// Chain configuration
export const l1Chain = defineChain({
  id: 31337,
  name: "local L1",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [process.env.L1_RPC!],
    },
  },
});

export const l2Chain = defineChain({
  id: 6565,
  name: "local L2",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [process.env.L2_RPC!],
    },
  },
});