import { describe, it, expect } from 'bun:test';
import { AbiCoder, ethers } from 'ethers';

import * as ethersUtils from '../ethers/resources/utils';
import * as viemUtils from '../viem/resources/utils';
import {
  L2_NATIVE_TOKEN_VAULT_ADDRESS,
  L1_FEE_ESTIMATION_COEF_NUMERATOR,
  L1_FEE_ESTIMATION_COEF_DENOMINATOR,
  ETH_ADDRESS,
} from '../../core/constants';

const coder = new AbiCoder();

const SAMPLE = {
  chainId: 324n,
  amount: 1_234n,
  receiver: '0x1111111111111111111111111111111111111111' as const,
  token: '0x2222222222222222222222222222222222222222' as const,
  assetId: ethers.keccak256('0x1234'),
  transferData: '0xdeadbeef' as const,
};

describe('adapters/utils — encoding parity', () => {
  it('encodeNativeTokenVaultAssetId matches between ethers & viem implementations', () => {
    const ethersEncoded = ethersUtils.encodeNativeTokenVaultAssetId(SAMPLE.chainId, SAMPLE.token);
    const viemEncoded = viemUtils
      .encodeNativeTokenVaultAssetId(SAMPLE.chainId, SAMPLE.token)
      .toLowerCase();

    expect(ethersEncoded.toLowerCase()).toBe(viemEncoded);
    expect(ethersUtils.encodeNTVAssetId(SAMPLE.chainId, SAMPLE.token).toLowerCase()).toBe(
      ethersEncoded.toLowerCase(),
    );
  });

  it('encodeNativeTokenVaultTransferData encodes amount/receiver/token identically', () => {
    const ethersEncoded = ethersUtils.encodeNativeTokenVaultTransferData(
      SAMPLE.amount,
      SAMPLE.receiver,
      SAMPLE.token,
    );
    const viemEncoded = viemUtils
      .encodeNativeTokenVaultTransferData(SAMPLE.amount, SAMPLE.receiver, SAMPLE.token)
      .toLowerCase();

    expect(ethersEncoded.toLowerCase()).toBe(viemEncoded);

    const [amount, receiver, token] = coder.decode(
      ['uint256', 'address', 'address'],
      ethersEncoded,
    );
    expect(BigInt(amount.toString())).toBe(SAMPLE.amount);
    expect((receiver as string).toLowerCase()).toBe(SAMPLE.receiver.toLowerCase());
    expect((token as string).toLowerCase()).toBe(SAMPLE.token.toLowerCase());
    expect(ethersUtils.encodeNTVTransferData(SAMPLE.amount, SAMPLE.receiver, SAMPLE.token)).toBe(
      ethersEncoded,
    );
  });

  it('encodeSecondBridgeDataV1 prefixes 0x01 and encodes payload equally', () => {
    const ethersEncoded = ethersUtils.encodeSecondBridgeDataV1(
      SAMPLE.assetId,
      SAMPLE.transferData as `0x${string}`,
    );
    const viemEncoded = viemUtils
      .encodeSecondBridgeDataV1(
        SAMPLE.assetId as `0x${string}`,
        SAMPLE.transferData as `0x${string}`,
      )
      .toLowerCase();

    expect(ethersEncoded.toLowerCase()).toBe(viemEncoded);
    expect(ethersEncoded.startsWith('0x01')).toBe(true);
  });

  it('encodeSecondBridgeErc20Args and encodeSecondBridgeEthArgs align', () => {
    const erc20Ethers = ethersUtils.encodeSecondBridgeErc20Args(
      SAMPLE.token,
      SAMPLE.amount,
      SAMPLE.receiver,
    );
    const erc20Viem = viemUtils
      .encodeSecondBridgeErc20Args(SAMPLE.token, SAMPLE.amount, SAMPLE.receiver)
      .toLowerCase();
    expect(erc20Ethers.toLowerCase()).toBe(erc20Viem);

    const ethEthers = ethersUtils.encodeSecondBridgeEthArgs(SAMPLE.amount, SAMPLE.receiver);
    const ethViem = viemUtils
      .encodeSecondBridgeEthArgs(SAMPLE.amount, SAMPLE.receiver, ETH_ADDRESS)
      .toLowerCase();
    expect(ethEthers.toLowerCase()).toBe(ethViem);
  });
});

describe('adapters/utils — gas helpers', () => {
  it('scaleGasLimit uses the same coefficient across implementations', () => {
    const gas = 1_000_001n;
    const expected =
      (gas * BigInt(L1_FEE_ESTIMATION_COEF_NUMERATOR)) / BigInt(L1_FEE_ESTIMATION_COEF_DENOMINATOR);
    expect(ethersUtils.scaleGasLimit(gas)).toBe(expected);
    expect(viemUtils.scaleGasLimit(gas)).toBe(expected);
  });

  it('checkBaseCost resolves/throws consistently', async () => {
    await expect(ethersUtils.checkBaseCost(100n, Promise.resolve(150n))).resolves.toBeUndefined();
    await expect(viemUtils.checkBaseCost(100n, Promise.resolve(150n))).resolves.toBeUndefined();

    await expect(ethersUtils.checkBaseCost(200n, Promise.resolve(150n))).rejects.toThrow(
      /base cost/i,
    );
    await expect(viemUtils.checkBaseCost(200n, Promise.resolve(150n))).rejects.toThrow(
      /base cost/i,
    );
  });

  it('getFeeOverrides handles 1559 data similarly', async () => {
    const ethersClient: any = {
      l1: {
        async getFeeData() {
          return { maxFeePerGas: 100n, maxPriorityFeePerGas: 2n, gasPrice: null };
        },
      },
    };
    const viemClient: any = {
      l1: {
        async estimateFeesPerGas() {
          return { maxFeePerGas: 100n, maxPriorityFeePerGas: 2n, gasPrice: null };
        },
        async getGasPrice() {
          return Promise.reject(new Error('should not be used'));
        },
      },
    };
    await expect(ethersUtils.getFeeOverrides(ethersClient)).resolves.toEqual({
      gasLimit: undefined,
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 2n,
      gasPriceForBaseCost: 100n,
    });
    await expect(viemUtils.getFeeOverrides(viemClient)).resolves.toEqual({
      gasLimit: undefined,
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 2n,
      gasPriceForBaseCost: 100n,
    });
  });

  it('getFeeOverrides applies explicit overrides', async () => {
    const ethersClient: any = {
      l1: {
        async getFeeData() {
          return { maxFeePerGas: 100n, maxPriorityFeePerGas: 5n, gasPrice: null };
        },
      },
    };
    const viemClient: any = {
      l1: {
        async estimateFeesPerGas() {
          return { maxFeePerGas: 100n, maxPriorityFeePerGas: 5n, gasPrice: null };
        },
        async getGasPrice() {
          return Promise.reject(new Error('should not be used'));
        },
      },
    };
    const overrides = { gasLimit: 999_999n, maxFeePerGas: 200n, maxPriorityFeePerGas: 10n };
    await expect(ethersUtils.getFeeOverrides(ethersClient, overrides)).resolves.toEqual({
      gasLimit: 999_999n,
      maxFeePerGas: 200n,
      maxPriorityFeePerGas: 10n,
      gasPriceForBaseCost: 200n,
    });
    await expect(viemUtils.getFeeOverrides(viemClient, overrides)).resolves.toEqual({
      gasLimit: 999_999n,
      maxFeePerGas: 200n,
      maxPriorityFeePerGas: 10n,
      gasPriceForBaseCost: 200n,
    });
  });

  it('getL2FeeOverrides handles provider data and overrides', async () => {
    const ethersClient: any = {
      l2: {
        async getFeeData() {
          return { maxFeePerGas: 99n, maxPriorityFeePerGas: 3n, gasPrice: 88n };
        },
        async getGasPrice() {
          return 77n;
        },
      },
    };
    const viemClient: any = {
      l2: {
        async estimateFeesPerGas() {
          return { maxFeePerGas: 99n, maxPriorityFeePerGas: 3n, gasPrice: 88n };
        },
        async getGasPrice() {
          return 77n;
        },
      },
    };
    await expect(ethersUtils.getL2FeeOverrides(ethersClient, undefined)).resolves.toEqual({
      gasLimit: undefined,
      maxFeePerGas: 99n,
      maxPriorityFeePerGas: 3n,
    });
    await expect(viemUtils.getL2FeeOverrides(viemClient, undefined)).resolves.toEqual({
      gasLimit: undefined,
      maxFeePerGas: 99n,
      maxPriorityFeePerGas: 3n,
    });

    const overrides = { gasLimit: 123_456n, maxFeePerGas: 200n };
    await expect(ethersUtils.getL2FeeOverrides(ethersClient, overrides)).resolves.toEqual({
      gasLimit: 123_456n,
      maxFeePerGas: 200n,
      maxPriorityFeePerGas: 3n,
    });
    await expect(viemUtils.getL2FeeOverrides(viemClient, overrides)).resolves.toEqual({
      gasLimit: 123_456n,
      maxFeePerGas: 200n,
      maxPriorityFeePerGas: 3n,
    });
  });

  it('getFeeOverrides falls back to gasPrice for legacy mode', async () => {
    const ethersClient: any = {
      l1: {
        async getFeeData() {
          return { gasPrice: 55n, maxFeePerGas: null, maxPriorityFeePerGas: null };
        },
      },
    };
    const viemClient: any = {
      l1: {
        async estimateFeesPerGas() {
          throw new Error('no 1559 support');
        },
        async getGasPrice() {
          return 55n;
        },
      },
    };
    await expect(ethersUtils.getFeeOverrides(ethersClient)).resolves.toEqual({
      gasLimit: undefined,
      maxFeePerGas: 55n,
      maxPriorityFeePerGas: 55n,
      gasPriceForBaseCost: 55n,
    });
    await expect(viemUtils.getFeeOverrides(viemClient)).resolves.toEqual({
      gasLimit: undefined,
      maxFeePerGas: 55n,
      maxPriorityFeePerGas: 55n,
      gasPriceForBaseCost: 55n,
    });
  });

  it('getGasPriceWei prefers gasPrice then falls back to maxFeePerGas', async () => {
    const ethersClient: any = {
      l1: {
        async getFeeData() {
          return { gasPrice: 77n, maxFeePerGas: 100n };
        },
      },
    };
    const viemClient: any = {
      l1: {
        async getGasPrice() {
          return 77n;
        },
        async estimateFeesPerGas() {
          return { maxFeePerGas: 100n };
        },
      },
    };
    await expect(ethersUtils.getGasPriceWei(ethersClient)).resolves.toBe(77n);
    await expect(viemUtils.getGasPriceWei(viemClient)).resolves.toBe(77n);

    const ethersFallback: any = {
      l1: {
        async getFeeData() {
          return { gasPrice: null, maxFeePerGas: 90n };
        },
      },
    };
    const viemFallback: any = {
      l1: {
        async getGasPrice() {
          throw new Error('no gasPrice');
        },
        async estimateFeesPerGas() {
          return { maxFeePerGas: 90n };
        },
      },
    };
    await expect(ethersUtils.getGasPriceWei(ethersFallback)).resolves.toBe(90n);
    await expect(viemUtils.getGasPriceWei(viemFallback)).resolves.toBe(90n);
  });
});

describe('adapters/utils — direct request builder', () => {
  it('buildDirectRequestStruct produces equivalent payloads', () => {
    const args = {
      chainId: 324n,
      mintValue: 1_000n,
      l2GasLimit: 500_000n,
      gasPerPubdata: 800n,
      refundRecipient: SAMPLE.receiver,
      l2Contract: SAMPLE.token,
      l2Value: 123n,
    };

    const ethersStruct = ethersUtils.buildDirectRequestStruct(args);
    const viemStruct = viemUtils.buildDirectRequestStruct(args);
    expect(viemStruct).toEqual(ethersStruct);
    expect(ethersStruct.l2Calldata).toBe('0x');
  });
});
