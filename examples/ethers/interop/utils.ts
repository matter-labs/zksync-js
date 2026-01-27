import { AbiCoder, Contract, Wallet, parseUnits } from 'ethers';
import type { Address } from '../../../src/core';
import { L2_NATIVE_TOKEN_VAULT_ADDRESS } from '../../../src/core/constants';
import { L2NativeTokenVaultABI } from '../../../src/core/abi';
import { ERC20_BYTECODE, GREETING_BYTECODE } from '../../interop/constants';

export async function getGreetingTokenAddress(args: {
  signer: Wallet;
  greeting?: string;
}): Promise<Address> {
  const greeting = args.greeting ?? 'hello from destination';
  const constructorArgs = AbiCoder.defaultAbiCoder().encode(['string'], [greeting]);
  const deployData = GREETING_BYTECODE + constructorArgs.substring(2);

  const deployTx = await args.signer.sendTransaction({ data: deployData });
  const deployReceipt = await deployTx.wait();
  if (!deployReceipt?.contractAddress) {
    throw new Error('Greeting contract deployment failed: missing contract address.');
  }

  return deployReceipt.contractAddress as Address;
}

export async function getErc20TokenAddress(args: {
  signer: Wallet;
  initialSupply?: bigint;
  register?: boolean;
}): Promise<Address> {
  const initialSupply = args.initialSupply ?? parseUnits('1000000', 18);
  const constructorArgs = AbiCoder.defaultAbiCoder().encode(['uint256'], [initialSupply]);
  const deployData = ERC20_BYTECODE + constructorArgs.substring(2);

  const deployTx = await args.signer.sendTransaction({ data: deployData });
  const deployReceipt = await deployTx.wait();
  if (!deployReceipt?.contractAddress) {
    throw new Error('ERC20 deployment failed: missing contract address.');
  }
  const tokenAddress = deployReceipt.contractAddress as Address;

  if (args.register !== false) {
    const nativeTokenVault = new Contract(
      L2_NATIVE_TOKEN_VAULT_ADDRESS,
      L2NativeTokenVaultABI,
      args.signer,
    );
    const registerTx = await nativeTokenVault.ensureTokenIsRegistered(tokenAddress);
    await registerTx.wait();
  }

  return tokenAddress;
}
