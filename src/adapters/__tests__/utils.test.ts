import { describe, it, expect } from 'bun:test';
import { AbiCoder, ethers } from 'ethers';

import * as ethersUtils from '../ethers/resources/utils';
import * as viemUtils from '../viem/resources/utils';
import { ETH_ADDRESS } from '../../core/constants';

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
