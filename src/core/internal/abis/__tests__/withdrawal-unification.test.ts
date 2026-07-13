import { describe, expect, it } from 'bun:test';
import {
  IBaseTokenABI,
  IInteropCenterABI,
  IInteropHandlerABI,
  IInteropHandlerBaseABI,
  IL1NullifierABI,
  IL2AssetRouterABI,
} from '../../../abi';

function functionNames(abi: readonly { type: string; name?: string }[]) {
  return abi.filter((item) => item.type === 'function').map((item) => item.name);
}

function eventNames(abi: readonly { type: string; name?: string }[]) {
  return abi.filter((item) => item.type === 'event').map((item) => item.name);
}

describe('unified withdrawal ABI surface', () => {
  it('removes standalone base-token withdrawal members and events', () => {
    expect(functionNames(IBaseTokenABI)).not.toContain('withdraw');
    expect(functionNames(IBaseTokenABI)).not.toContain('withdrawWithMessage');
    expect(eventNames(IBaseTokenABI)).not.toContain('Withdrawal');
    expect(eventNames(IBaseTokenABI)).not.toContain('WithdrawalWithMessage');
    expect(functionNames(IBaseTokenABI)).toContain('initializeBaseTokenHolderBalance');
  });

  it('replaces asset-router withdrawal methods with indirect calls', () => {
    expect(functionNames(IL2AssetRouterABI)).not.toContain('withdraw');
    expect(functionNames(IL2AssetRouterABI)).not.toContain('withdrawLegacyBridge');
    expect(eventNames(IL2AssetRouterABI)).not.toContain('BridgehubWithdrawalInitiated');
    expect(eventNames(IL2AssetRouterABI)).not.toContain('WithdrawalInitiatedAssetRouter');
    expect(functionNames(IL2AssetRouterABI)).toContain('initiateIndirectCall');
  });

  it('removes nullifier withdrawal finalization and replay methods', () => {
    expect(functionNames(IL1NullifierABI)).not.toContain('finalizeDeposit');
    expect(functionNames(IL1NullifierABI)).not.toContain('finalizeWithdrawal');
    expect(functionNames(IL1NullifierABI)).not.toContain('isWithdrawalFinalized');
    expect(functionNames(IL1NullifierABI)).toContain('l1InteropHandler');
  });

  it('retains IInteropHandlerABI as the status-only common-handler alias', () => {
    expect(IInteropHandlerABI).toBe(IInteropHandlerBaseABI);
    expect(functionNames(IInteropHandlerABI)).toContain('bundleStatus');
    expect(functionNames(IInteropHandlerABI)).not.toContain('verifyBundle');
    expect(functionNames(IInteropHandlerABI)).not.toContain('unbundleBundle');
    expect(functionNames(IInteropHandlerABI)).not.toContain('L1_CHAIN_ID');
    expect(functionNames(IInteropHandlerABI)).not.toContain('initL2');
  });

  it('uses unique bundle salts instead of the obsolete interop nonce model', () => {
    expect(functionNames(IInteropCenterABI)).toContain('isInteropBundleSaltUsed');
    expect(functionNames(IInteropCenterABI)).not.toContain('interopBundleNonce');
    const sentEvent = IInteropCenterABI.find(
      (item) => item.type === 'event' && item.name === 'InteropBundleSent',
    );
    expect(JSON.stringify(sentEvent)).toContain('"name":"salt"');
  });
});
