import { useCallback, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type TransactionReceipt,
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEther,
  stringify,
} from 'viem';
import { sepolia } from 'viem/chains';
import 'viem/window';

import { createViemClient, createViemSdk, type ViemSdk } from '@matterlabs/zksync-js/viem';
import type {
  WithdrawHandle,
  WithdrawPlan,
  WithdrawQuote,
  WithdrawalStatus,
} from '@matterlabs/zksync-js/core';
import { ETH_ADDRESS } from '@matterlabs/zksync-js/core';

const DEFAULT_L1_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const DEFAULT_L2_RPC = 'https://zksync-os-testnet-alpha.zksync.dev/';

const l1Client = createPublicClient({
  chain: sepolia,
  transport: http(DEFAULT_L1_RPC),
});

const parseOptionalBigInt = (value: string, label: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return BigInt(trimmed);
  } catch {
    throw new Error(`${label} must be a whole number (wei).`);
  }
};

const makeZkSyncChain = (chainId: number, rpc: string): Chain => ({
  id: chainId,
  name: `Connected ChainID ${chainId}`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [rpc] },
    public: { http: [rpc] },
  },
});

type Action =
  | 'connect'
  | 'quote'
  | 'prepare'
  | 'create'
  | 'status'
  | 'waitL2'
  | 'waitReady'
  | 'waitFinalized'
  | 'finalize';

interface ResultCardProps {
  title: string;
  data: unknown | null | undefined;
}

function ResultCard({ title, data }: ResultCardProps) {
  if (data == null) return null;
  return (
    <section className="result-card">
      <h3>{title}</h3>
      <pre>
        <code>{stringify(data, null, 2)}</code>
      </pre>
    </section>
  );
}

function Example() {
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [connectedL2Chain, setConnectedL2Chain] = useState<Chain>();
  const [connectedL2Rpc, setConnectedL2Rpc] = useState(DEFAULT_L2_RPC);

  const [account, setAccount] = useState<Address>();
  const [sdk, setSdk] = useState<ViemSdk>();
  const [quote, setQuote] = useState<WithdrawQuote>();
  const [plan, setPlan] = useState<WithdrawPlan<unknown>>();
  const [handle, setHandle] = useState<WithdrawHandle<unknown>>();
  const [status, setStatus] = useState<WithdrawalStatus>();
  const [waitL2Result, setWaitL2Result] = useState<unknown>();
  const [waitReadyResult, setWaitReadyResult] = useState<unknown>();
  const [waitFinalizedResult, setWaitFinalizedResult] = useState<TransactionReceipt | null>();
  const [finalizeResult, setFinalizeResult] = useState<
    { status: WithdrawalStatus; receipt?: TransactionReceipt } | undefined
  >();

  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<Action | null>(null);

  // Minimal inputs
  const [l2Rpc, setL2Rpc] = useState(DEFAULT_L2_RPC);
  const [amount, setAmount] = useState('0.01');
  const [token, setToken] = useState(ETH_ADDRESS);
  const [recipient, setRecipient] = useState('');
  const [l2GasLimitInput, setL2GasLimitInput] = useState(''); // leave blank to auto-estimate
  const [l2MaxFeeInput, setL2MaxFeeInput] = useState('');
  const [l2PriorityFeeInput, setL2PriorityFeeInput] = useState('');
  const [l2TxInput, setL2TxInput] = useState('');

  const targetL2Rpc = useMemo(() => l2Rpc.trim() || DEFAULT_L2_RPC, [l2Rpc]);
  const walletClient = useMemo(() => {
    if (typeof window === 'undefined' || !window.ethereum) return null;
    return createWalletClient({
      chain: sepolia,
      transport: custom(window.ethereum as EIP1193Provider),
    });
  }, []);

  const run = useCallback(
    async <T,>(action: Action, fn: () => Promise<T>, onSuccess?: (value: T) => void) => {
      setBusy(action);
      setError(undefined);
      try {
        const value = await fn();
        onSuccess?.(value);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const instantiateSdk = useCallback(async (addr: Address, prov: EIP1193Provider, rpc: string) => {
    const transport = custom(prov);

    const l1Wallet = createWalletClient({
      account: addr,
      chain: sepolia,
      transport,
    });

    const probe = createPublicClient({ transport: http(rpc) });
    const l2ChainId = await probe.getChainId();
    const zkSyncChain = makeZkSyncChain(Number(l2ChainId), rpc);

    const l2Public = createPublicClient({
      chain: zkSyncChain,
      transport: http(rpc),
    });

    const l2Wallet = createWalletClient({
      account: addr,
      chain: zkSyncChain,
      transport,
    });

    const client = createViemClient({
      l1: l1Client as any,
      l2: l2Public as any,
      l1Wallet: l1Wallet as any,
      l2Wallet: l2Wallet as any,
    } as any);

    const instance = createViemSdk(client);
    return { instance, chain: zkSyncChain };
  }, []);

  const refreshSdkIfNeeded = useCallback(async (): Promise<ViemSdk> => {
    if (!provider || !account) throw new Error('Connect wallet first.');
    if (sdk && connectedL2Rpc === targetL2Rpc) return sdk;

    const { instance, chain } = await instantiateSdk(account, provider, targetL2Rpc);
    setSdk(instance);
    setConnectedL2Chain(chain);
    setConnectedL2Rpc(targetL2Rpc);
    return instance;
  }, [account, connectedL2Rpc, instantiateSdk, provider, sdk, targetL2Rpc]);

  const buildParams = useCallback(() => {
    if (!account) throw new Error('Connect wallet first.');

    const trimmedAmount = amount.trim();
    if (!trimmedAmount) throw new Error('Provide an amount.');

    const parsedAmount = (() => {
      try {
        return parseEther(trimmedAmount);
      } catch {
        throw new Error('Amount must be a valid ETH value (e.g. 0.05).');
      }
    })();

    const tokenAddr = token.trim() || ETH_ADDRESS;
    if (!tokenAddr.startsWith('0x')) {
      throw new Error('Token address must be 0x-prefixed.');
    }

    const toAddress = (recipient.trim() || account) as Address;
    const l2GasLimit = l2GasLimitInput.trim()
      ? parseOptionalBigInt(l2GasLimitInput, 'L2 gas limit')
      : undefined;

    const overrides = {
      maxFeePerGas: l2MaxFeeInput.trim()
        ? parseOptionalBigInt(l2MaxFeeInput, 'Max fee per gas')
        : undefined,
      maxPriorityFeePerGas: l2PriorityFeeInput.trim()
        ? parseOptionalBigInt(l2PriorityFeeInput, 'Max priority fee per gas')
        : undefined,
    };

    const hasOverrides = overrides.maxFeePerGas != null || overrides.maxPriorityFeePerGas != null;

    return {
      amount: parsedAmount,
      token: tokenAddr as Address,
      to: toAddress,
      ...(l2GasLimit != null ? { l2GasLimit } : {}),
      ...(hasOverrides ? { l2TxOverrides: overrides } : {}),
    } as const;
  }, [account, amount, token, recipient, l2GasLimitInput, l2MaxFeeInput, l2PriorityFeeInput]);

  const handleConnected = useCallback(
    ({
      address,
      provider: nextProvider,
      chain,
      sdk: instance,
    }: {
      address: Address;
      provider: EIP1193Provider;
      chain: Chain;
      sdk: ViemSdk;
    }) => {
      setAccount(address);
      setProvider(nextProvider);
      setSdk(instance);
      setConnectedL2Chain(chain);
      setConnectedL2Rpc(targetL2Rpc);
      setRecipient((prev) => prev || address);
      setQuote(undefined);
      setPlan(undefined);
      setHandle(undefined);
      setStatus(undefined);
      setWaitL2Result(undefined);
      setWaitReadyResult(undefined);
      setWaitFinalizedResult(undefined);
      setFinalizeResult(undefined);
      setL2TxInput('');
    },
    [targetL2Rpc],
  );

  const connectWallet = useCallback(() => {
    if (!walletClient) {
      setError('No injected wallet found. Install MetaMask or another wallet.');
      return;
    }

    return run(
      'connect',
      async () => {
        const [address] = await walletClient.requestAddresses();
        if (!address) throw new Error('Wallet returned no accounts.');
        const providerObj = window.ethereum as EIP1193Provider | undefined;
        if (!providerObj) {
          throw new Error('No injected wallet found. Connect your wallet again.');
        }
        const addr = address as Address;
        const { instance, chain } = await instantiateSdk(addr, providerObj, targetL2Rpc);
        return { address: addr, provider: providerObj, sdk: instance, chain };
      },
      ({ address, provider: nextProvider, sdk: instance, chain }) =>
        handleConnected({ address, provider: nextProvider, sdk: instance, chain }),
    );
  }, [handleConnected, instantiateSdk, run, targetL2Rpc, walletClient]);

  const hasWaitableInput = handle != null || Boolean(l2TxInput.trim());
  const hasFinalizableHash = Boolean(l2TxInput.trim() || handle?.l2TxHash);

  const actionDisabled = (
    action: Action,
    opts?: { requiresHandle?: boolean; requiresWaitable?: boolean; requiresHash?: boolean },
  ) => {
    if (busy && busy !== action) return true;
    if (!account && action !== 'connect') return true;
    if (opts?.requiresHandle && !handle) return true;
    if (opts?.requiresWaitable && !hasWaitableInput) return true;
    if (opts?.requiresHash && !hasFinalizableHash) return true;
    return false;
  };

  const resolveWaitable = useCallback(() => {
    const trimmed = l2TxInput.trim();
    if (trimmed) return trimmed as Hex;
    if (handle) return handle;
    return null;
  }, [handle, l2TxInput]);

  const resolveL2Hash = useCallback(() => {
    const trimmed = l2TxInput.trim();
    if (trimmed) return trimmed as Hex;
    if (handle?.l2TxHash) return handle.l2TxHash as Hex;
    return null;
  }, [handle, l2TxInput]);

  const assertWalletOnChain = useCallback(
    async (expectedChainId: number, label: string) => {
      if (!provider || typeof provider.request !== 'function') {
        throw new Error('No injected wallet found. Connect your wallet again.');
      }
      try {
        const currentHex = await provider.request({ method: 'eth_chainId' });
        if (typeof currentHex === 'string') {
          const parsed = Number.parseInt(currentHex, 16);
          if (Number.isFinite(parsed) && parsed !== expectedChainId) {
            throw new Error(`Switch your wallet to ${label} (chain id ${expectedChainId}).`);
          }
        }
      } catch (err) {
        throw new Error(
          `Unable to verify wallet chain. ${err instanceof Error ? err.message : err}`,
        );
      }
    },
    [provider],
  );

  const assertWalletOnL2 = useCallback(async () => {
    if (!connectedL2Chain) {
      throw new Error('Connect wallet again to resolve the target L2 chain.');
    }
    await assertWalletOnChain(connectedL2Chain.id, `target L2`);
  }, [assertWalletOnChain, connectedL2Chain]);

  const assertWalletOnL1 = useCallback(async () => {
    await assertWalletOnChain(sepolia.id, 'Sepolia');
  }, [assertWalletOnChain]);

  const quoteWithdrawal = useCallback(
    () =>
      run(
        'quote',
        async () => {
          const currentSdk = await refreshSdkIfNeeded();
          const params = buildParams();
          const result = await currentSdk.withdrawals.tryQuote(params);
          if (!result.ok) throw result.error;
          return result.value;
        },
        setQuote,
      ),
    [buildParams, refreshSdkIfNeeded, run],
  );

  const prepareWithdrawal = useCallback(
    () =>
      run(
        'prepare',
        async () => {
          const currentSdk = await refreshSdkIfNeeded();
          const params = buildParams();
          const result = await currentSdk.withdrawals.tryPrepare(params);
          if (!result.ok) throw result.error;
          return result.value;
        },
        setPlan,
      ),
    [buildParams, refreshSdkIfNeeded, run],
  );

  const createWithdrawal = useCallback(
    () =>
      run(
        'create',
        async () => {
          await assertWalletOnL2();
          const currentSdk = await refreshSdkIfNeeded();
          const params = buildParams();
          const result = await currentSdk.withdrawals.tryCreate(params);
          if (!result.ok) throw result.error;
          return result.value;
        },
        (value) => {
          setHandle(value);
          setStatus(undefined);
          setWaitL2Result(undefined);
          setWaitReadyResult(undefined);
          setWaitFinalizedResult(undefined);
          setFinalizeResult(undefined);
          setL2TxInput(value.l2TxHash ?? '');
        },
      ),
    [assertWalletOnL2, buildParams, refreshSdkIfNeeded, run],
  );

  const checkStatus = useCallback(
    () =>
      run(
        'status',
        async () => {
          const waitable = resolveWaitable();
          if (!waitable) throw new Error('Provide an L2 transaction hash or create a withdrawal.');
          const currentSdk = await refreshSdkIfNeeded();
          return currentSdk.withdrawals.status(waitable);
        },
        setStatus,
      ),
    [refreshSdkIfNeeded, resolveWaitable, run],
  );

  const waitForL2 = useCallback(
    () =>
      run(
        'waitL2',
        async () => {
          const waitable = resolveWaitable();
          if (!waitable) throw new Error('Provide an L2 transaction hash or create a withdrawal.');
          const currentSdk = await refreshSdkIfNeeded();
          return currentSdk.withdrawals.wait(waitable, { for: 'l2' });
        },
        setWaitL2Result,
      ),
    [refreshSdkIfNeeded, resolveWaitable, run],
  );

  const waitForReady = useCallback(
    () =>
      run(
        'waitReady',
        async () => {
          const waitable = resolveWaitable();
          if (!waitable) throw new Error('Provide an L2 transaction hash or create a withdrawal.');
          const currentSdk = await refreshSdkIfNeeded();
          return currentSdk.withdrawals.wait(waitable, { for: 'ready' });
        },
        (value) => setWaitReadyResult(value ?? { ready: true }),
      ),
    [refreshSdkIfNeeded, resolveWaitable, run],
  );

  const waitForFinalized = useCallback(
    () =>
      run(
        'waitFinalized',
        async () => {
          const waitable = resolveWaitable();
          if (!waitable) throw new Error('Provide an L2 transaction hash or create a withdrawal.');
          const currentSdk = await refreshSdkIfNeeded();
          return currentSdk.withdrawals.wait(waitable, { for: 'finalized' });
        },
        (value) => setWaitFinalizedResult(value ?? null),
      ),
    [refreshSdkIfNeeded, resolveWaitable, run],
  );

  const finalizeWithdrawal = useCallback(
    () =>
      run(
        'finalize',
        async () => {
          const hash = resolveL2Hash();
          if (!hash) throw new Error('Provide an L2 transaction hash or create a withdrawal.');
          await assertWalletOnL1();
          const currentSdk = await refreshSdkIfNeeded();
          const result = await currentSdk.withdrawals.tryFinalize(hash);
          if (!result.ok) throw result.error;
          return result.value;
        },
        setFinalizeResult,
      ),
    [assertWalletOnL1, refreshSdkIfNeeded, resolveL2Hash, run],
  );

  return (
    <main>
      <h1>Viem Withdrawals (UI example)</h1>

      <section>
        <h2>Wallet</h2>
        <div className="field">
          <label>Account</label>
          <input readOnly value={account ?? ''} placeholder="Not connected" />
        </div>
        <div className="inline-fields">
          <div className="field">
            <label>L1 RPC</label>
            <input readOnly value={DEFAULT_L1_RPC} />
          </div>
          <div className="field">
            <label>L2 RPC</label>
            <input
              value={l2Rpc}
              onChange={(event) => setL2Rpc(event.target.value)}
              placeholder={DEFAULT_L2_RPC}
            />
          </div>
        </div>
        <button onClick={connectWallet} disabled={actionDisabled('connect')}>
          {busy === 'connect' ? 'Connecting…' : account ? 'Reconnect' : 'Connect Wallet'}
        </button>
      </section>

      <section>
        <h2>Withdrawal parameters</h2>
        <div className="field">
          <label>Amount</label>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.05"
          />
        </div>
        <div className="field">
          <label>Token address</label>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={ETH_ADDRESS}
          />
        </div>
        <div className="field">
          <label>Recipient (defaults to connected account)</label>
          <input
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder={account}
          />
        </div>
        <div className="inline-fields">
          <div className="field">
            <label>L2 gas limit</label>
            <input
              value={l2GasLimitInput}
              onChange={(event) => setL2GasLimitInput(event.target.value)}
              placeholder="Leave blank to auto-estimate"
            />
          </div>
          <div className="field">
            <label>Max fee per gas (wei)</label>
            <input
              value={l2MaxFeeInput}
              onChange={(event) => setL2MaxFeeInput(event.target.value)}
              placeholder="Leave blank to auto-estimate"
            />
          </div>
          <div className="field">
            <label>Max priority fee per gas (wei)</label>
            <input
              value={l2PriorityFeeInput}
              onChange={(event) => setL2PriorityFeeInput(event.target.value)}
              placeholder="Leave blank to auto-estimate"
            />
          </div>
        </div>
        <div className="field">
          <label>L2 transaction hash (for status/finalize)</label>
          <input
            value={l2TxInput}
            onChange={(event) => setL2TxInput(event.target.value)}
            placeholder="0x…"
          />
        </div>
        {/* Removed preview sentence */}
      </section>

      <section>
        <h2>Actions</h2>
        <div className="inline-fields">
          <button onClick={quoteWithdrawal} disabled={actionDisabled('quote')}>
            {busy === 'quote' ? 'Quoting…' : 'Quote'}
          </button>
          <button onClick={prepareWithdrawal} disabled={actionDisabled('prepare')}>
            {busy === 'prepare' ? 'Preparing…' : 'Prepare'}
          </button>
          <button onClick={createWithdrawal} disabled={actionDisabled('create')}>
            {busy === 'create' ? 'Submitting…' : 'Create'}
          </button>
          <button
            onClick={checkStatus}
            disabled={actionDisabled('status', { requiresWaitable: true })}
          >
            {busy === 'status' ? 'Checking…' : 'Status'}
          </button>
          <button
            onClick={waitForL2}
            disabled={actionDisabled('waitL2', { requiresWaitable: true })}
          >
            {busy === 'waitL2' ? 'Waiting…' : 'Wait (L2)'}
          </button>
          <button
            onClick={waitForReady}
            disabled={actionDisabled('waitReady', { requiresWaitable: true })}
          >
            {busy === 'waitReady' ? 'Waiting…' : 'Wait (Ready)'}
          </button>
          <button
            onClick={waitForFinalized}
            disabled={actionDisabled('waitFinalized', { requiresWaitable: true })}
          >
            {busy === 'waitFinalized' ? 'Waiting…' : 'Wait (Finalized)'}
          </button>
          <button
            onClick={finalizeWithdrawal}
            disabled={actionDisabled('finalize', { requiresHash: true })}
          >
            {busy === 'finalize' ? 'Submitting…' : 'Finalize on L1'}
          </button>
        </div>
      </section>

      <section className="results">
        <ResultCard title="Quote" data={quote} />
        <ResultCard title="Prepare" data={plan} />
        <ResultCard title="Create" data={handle} />
        <ResultCard title="Status" data={status} />
        <ResultCard title="Wait (L2)" data={waitL2Result} />
        <ResultCard title="Wait (Ready)" data={waitReadyResult} />
        <ResultCard title="Wait (Finalized)" data={waitFinalizedResult} />
        <ResultCard title="Finalize" data={finalizeResult} />
      </section>
      {error && <div className="error">{error}</div>}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<Example />);
