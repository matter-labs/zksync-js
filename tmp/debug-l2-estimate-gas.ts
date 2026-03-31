/**
 * Temporary diagnostic script for comparing `estimateGas` to realized `gasUsed`
 * across multiple networks using raw viem clients.
 *
 * Required env:
 * - PRIVATE_KEY
 * - L1_RPC_URL
 * - L2_RPC_URL
 * - L2_RPC_URL_ERA
 * - L2_RPC_URL_BASE
 * - L1_ERC20_TOKEN
 * - L2_ERC20_TOKEN
 * - ERA_L2_ERC20_TOKEN
 * - L2_ERC20_LINK_BASE
 *
 * Optional env:
 * - TO (defaults to sender)
 * - WITHDRAW_AMOUNT_ETH (defaults to 0.0001)
 * - TRANSFER_AMOUNT_ETH (defaults to 0.00001)
 * - TRANSFER_AMOUNT_ERC20 (defaults to 1)
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { IBaseTokenABI, IERC20ABI } from '../src/core/abi.ts';
import { L2_BASE_TOKEN_ADDRESS } from '../src/core/constants.ts';

type ProbeCase = {
  caseName: string;
  to: Address;
  data: Hex;
  value: bigint;
};

type NetworkConfig = {
  network: string;
  rpcUrl: string;
  erc20Token: Address;
  includeWithdrawalLike: boolean;
};

type ProbeResult = {
  network: string;
  caseName: string;
  nonce?: number;
  to: Address;
  selectorOrDataLength: string;
  viemEstimateGas?: bigint;
  rawRpcEstimateGas?: bigint;
  sentGasLimit?: bigint;
  gasUsed?: bigint;
  gasUsedOverEstimateBps?: bigint;
  estimateOverActualBps?: bigint;
  effectiveGasPrice?: bigint;
  txHash?: Hex;
  estimateMismatch?: boolean;
  error?: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeHexBigint(value: string | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function summarizeData(data: Hex): string {
  if (data === '0x') {
    return 'dataLength=0';
  }
  const byteLength = (data.length - 2) / 2;
  const selector = data.slice(0, 10);
  return `selector=${selector} bytes=${byteLength}`;
}

function toRpcTx(tx: ProbeCase, from: Address) {
  return {
    from,
    to: tx.to,
    data: tx.data,
    value: toHex(tx.value),
  };
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}

function printJson(label: string, value: unknown) {
  console.log(JSON.stringify({ label, value }, jsonReplacer, 2));
}

function buildProbeCases(input: {
  to: Address;
  erc20Token: Address;
  transferAmountEth: bigint;
  transferAmountErc20: bigint;
  withdrawAmountEth: bigint;
  includeWithdrawalLike: boolean;
}): ProbeCase[] {
  const probes: ProbeCase[] = [];

  if (input.includeWithdrawalLike) {
    probes.push({
      caseName: 'withdrawal-like',
      to: L2_BASE_TOKEN_ADDRESS,
      data: encodeFunctionData({
        abi: IBaseTokenABI,
        functionName: 'withdraw',
        args: [input.to],
      }),
      value: input.withdrawAmountEth,
    });
  }

  probes.push({
    caseName: 'plain-eth-transfer',
    to: input.to,
    data: '0x',
    value: input.transferAmountEth,
  });

  probes.push({
    caseName: 'erc20-transfer',
    to: input.erc20Token,
    data: encodeFunctionData({
      abi: IERC20ABI,
      functionName: 'transfer',
      args: [input.to, input.transferAmountErc20],
    }),
    value: 0n,
  });

  return probes;
}

async function runProbeSuite(args: {
  config: NetworkConfig;
  account: ReturnType<typeof privateKeyToAccount>;
  to: Address;
  transferAmountEth: bigint;
  transferAmountErc20Raw: string;
  withdrawAmountEth: bigint;
}): Promise<{
  network: string;
  erc20Token: Address;
  transferAmountErc20: bigint;
  decimals: number;
  results: ProbeResult[];
}> {
  const { config, account, to, transferAmountEth, transferAmountErc20Raw, withdrawAmountEth } =
    args;

  const publicClient = createPublicClient({
    transport: http(config.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    transport: http(config.rpcUrl),
  });

  const decimals = (await publicClient.readContract({
    address: config.erc20Token,
    abi: IERC20ABI,
    functionName: 'decimals',
  })) as number;

  const transferAmountErc20 = parseUnits(transferAmountErc20Raw, decimals);
  const probes = buildProbeCases({
    to,
    erc20Token: config.erc20Token,
    transferAmountEth,
    transferAmountErc20,
    withdrawAmountEth,
    includeWithdrawalLike: config.includeWithdrawalLike,
  });

  const results: ProbeResult[] = [];
  let nextNonce = Number(
    await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    }),
  );

  for (const probe of probes) {
    const nonce = Number(nextNonce);
    try {
      const viemEstimateGas = await publicClient.estimateGas({
        account: account.address,
        to: probe.to,
        data: probe.data,
        value: probe.value,
      });

      const rawRpcEstimateGas = normalizeHexBigint(
        (await publicClient.request({
          method: 'eth_estimateGas',
          params: [toRpcTx(probe, account.address)],
        })) as string | bigint,
      );

      const txHash = await walletClient.sendTransaction({
        account,
        to: probe.to,
        data: probe.data,
        value: probe.value,
        gas: rawRpcEstimateGas,
        nonce,
      });
      nextNonce += 1;

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const gasUsed = receipt.gasUsed;

      results.push({
        network: config.network,
        caseName: probe.caseName,
        nonce,
        to: probe.to,
        selectorOrDataLength: summarizeData(probe.data),
        viemEstimateGas,
        rawRpcEstimateGas,
        sentGasLimit: rawRpcEstimateGas,
        gasUsed,
        gasUsedOverEstimateBps:
          rawRpcEstimateGas === 0n ? 0n : (gasUsed * 10_000n) / rawRpcEstimateGas,
        estimateOverActualBps: gasUsed === 0n ? 0n : (rawRpcEstimateGas * 10_000n) / gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        txHash,
        estimateMismatch: viemEstimateGas !== rawRpcEstimateGas,
      });
    } catch (error) {
      results.push({
        network: config.network,
        caseName: probe.caseName,
        nonce,
        to: probe.to,
        selectorOrDataLength: summarizeData(probe.data),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    network: config.network,
    erc20Token: config.erc20Token,
    transferAmountErc20,
    decimals,
    results,
  };
}

async function main() {
  const account = privateKeyToAccount(requireEnv('PRIVATE_KEY') as Hex);
  const to = "0x228f34708591ECEEa61eb5E354ffA8b4453e5D52";

  const withdrawAmountEth = parseEther(process.env.WITHDRAW_AMOUNT_ETH ?? '0.0001');
  const transferAmountEth = parseEther(process.env.TRANSFER_AMOUNT_ETH ?? '0.00001');
  const transferAmountErc20Raw = process.env.TRANSFER_AMOUNT_ERC20 ?? '1';

  const networks: NetworkConfig[] = [
    {
      network: 'L1_ETH_SEPOLIA',
      rpcUrl: requireEnv('L1_RPC_URL'),
      erc20Token: requireEnv('L1_ERC20_TOKEN') as Address,
      includeWithdrawalLike: false,
    },
    {
      network: 'L2_ZKSYNCOS_TESTNET',
      rpcUrl: requireEnv('L2_RPC_URL'),
      erc20Token: requireEnv('L2_ERC20_TOKEN') as Address,
      includeWithdrawalLike: true,
    },
    {
      network: 'L2_ERA_SEPOLIA',
      rpcUrl: requireEnv('L2_RPC_URL_ERA'),
      erc20Token: requireEnv('ERA_L2_ERC20_TOKEN') as Address,
      includeWithdrawalLike: true,
    },
    {
      network: 'L2_BASE_SEPOLIA',
      rpcUrl: requireEnv('L2_RPC_URL_BASE'),
      erc20Token: requireEnv('L2_ERC20_LINK_BASE') as Address,
      includeWithdrawalLike: false,
    },
  ];

  printJson('run-config', {
    account: account.address,
    to,
    withdrawAmountEth,
    transferAmountEth,
    transferAmountErc20Raw,
    networks: networks.map((network) => ({
      network: network.network,
      erc20Token: network.erc20Token,
      includeWithdrawalLike: network.includeWithdrawalLike,
    })),
  });

  const suites = [];
  for (const network of networks) {
    const suite = await runProbeSuite({
      config: network,
      account,
      to,
      transferAmountEth,
      transferAmountErc20Raw,
      withdrawAmountEth,
    });
    suites.push(suite);
    printJson(`results:${network.network}`, suite);
  }

  printJson('summary', {
    account: account.address,
    to,
    withdrawAmountEth,
    transferAmountEth,
    transferAmountErc20Raw,
    suites,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
