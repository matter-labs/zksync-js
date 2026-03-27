import { createPublicClient, createWalletClient, encodeAbiParameters, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from '../../../src/core';
import { GREETING_BYTECODE, ERC20_BYTECODE } from '../../interop/constants';

export async function getGreetingAddress(args: {
  privateKey: `0x${string}`;
  rpcUrl: string;
  greeting?: string;
}): Promise<Address> {
  const greeting = args.greeting ?? 'hello from destination';
  const account = privateKeyToAccount(args.privateKey);
  const publicClient = createPublicClient({ transport: http(args.rpcUrl) });
  const walletClient = createWalletClient({ account, transport: http(args.rpcUrl) });

  const constructorArgs = encodeAbiParameters([{ type: 'string' }], [greeting]);
  const deployData = (GREETING_BYTECODE + constructorArgs.slice(2)) as `0x${string}`;

  const hash = await walletClient.sendTransaction({
    to: null,
    data: deployData,
    account,
    chain: null,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error('Greeting contract deployment failed: missing contract address.');
  }
  return receipt.contractAddress as Address;
}

export async function getErc20TokenAddress(args: {
  privateKey: `0x${string}`;
  rpcUrl: string;
  initialSupply?: bigint;
}): Promise<Address> {
  const initialSupply = args.initialSupply ?? 1_000_000n * 10n ** 18n;
  const account = privateKeyToAccount(args.privateKey);
  const publicClient = createPublicClient({ transport: http(args.rpcUrl) });
  const walletClient = createWalletClient({ account, transport: http(args.rpcUrl) });

  const constructorArgs = encodeAbiParameters([{ type: 'uint256' }], [initialSupply]);
  const deployData = (ERC20_BYTECODE + constructorArgs.slice(2)) as `0x${string}`;

  const hash = await walletClient.sendTransaction({
    to: null,
    data: deployData,
    account,
    chain: null,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error('ERC20 deployment failed: missing contract address.');
  }
  return receipt.contractAddress as Address;
}
