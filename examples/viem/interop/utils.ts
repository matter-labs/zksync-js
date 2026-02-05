import {
  encodeAbiParameters,
  parseUnits,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import type { Address } from '../../../src/core/types/primitives';
import { ERC20_BYTECODE, GREETING_BYTECODE } from '../../interop/constants';

function requireAccount(
  wallet: WalletClient,
): asserts wallet is WalletClient & { account: NonNullable<WalletClient['account']> } {
  if (!wallet.account) {
    throw new Error('WalletClient must have an account configured.');
  }
}

export async function getGreetingTokenAddress(args: {
  wallet: WalletClient;
  publicClient: PublicClient;
  greeting?: string;
}): Promise<Address> {
  requireAccount(args.wallet);

  const greeting = args.greeting ?? 'hello from destination';
  const constructorArgs = encodeAbiParameters([{ type: 'string', name: 'greeting' }], [greeting]);
  const deployData = (GREETING_BYTECODE + constructorArgs.slice(2)) as Hex;

  const hash = await args.wallet.sendTransaction({
    data: deployData,
    account: args.wallet.account,
  });

  const receipt = await args.publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error('Greeting contract deployment failed: missing contract address.');
  }
  return receipt.contractAddress as Address;
}

export async function getErc20TokenAddress(args: {
  wallet: WalletClient;
  publicClient: PublicClient;
  initialSupply?: bigint;
}): Promise<Address> {
  requireAccount(args.wallet);

  const initialSupply = args.initialSupply ?? parseUnits('1000000', 18);
  const constructorArgs = encodeAbiParameters(
    [{ type: 'uint256', name: 'initialSupply' }],
    [initialSupply],
  );
  const deployData = (ERC20_BYTECODE + constructorArgs.slice(2)) as Hex;

  const hash = await args.wallet.sendTransaction({
    data: deployData,
    account: args.wallet.account,
  });

  const receipt = await args.publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error('ERC20 deployment failed: missing contract address.');
  }
  const tokenAddress = receipt.contractAddress as Address;

  return tokenAddress;
}
