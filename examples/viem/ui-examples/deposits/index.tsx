import { useCallback, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  type Address,
  type EIP1193Provider,
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

import { createViemClient, createViemSdk, type ViemSdk } from '@matter-labs/zksync-js/viem';
import type {
  DepositHandle,
  DepositPlan,
  DepositQuote,
  DepositStatus,
} from '@matter-labs/zksync-js/core';
import {
  ETH_ADDRESS,
  L1_SOPH_TOKEN_ADDRESS,
  L2_BASE_TOKEN_ADDRESS,
} from '@matter-labs/zksync-js/core';

const DEFAULT_L1_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const DEFAULT_L2_RPC = 'https://zksync-os-testnet-alpha.zksync.dev/';

const l1 = createPublicClient({
  chain: sepolia,
  transport: http(DEFAULT_L1_RPC),
});

const TOKEN_OPTIONS: Array<{ label: string; value: Address }> = [
  { label: 'ETH', value: ETH_ADDRESS },
  { label: 'L2 Base Token', value: L2_BASE_TOKEN_ADDRESS },
  { label: 'SOPH (L1)', value: L1_SOPH_TOKEN_ADDRESS },
  { label: 'Test Token', value: '0x42E331a2613Fd3a5bc18b47AE3F01e1537fD8873' as Address },
];

const parseOptionalBigInt = (value: string, label: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return BigInt(trimmed);
  } catch {
    throw new Error(`${label} must be a whole number (wei).`);
  }
};

type Action = 'connect' | 'quote' | 'prepare' | 'create' | 'status' | 'waitL2';

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
  const [connectedL2Rpc, setConnectedL2Rpc] = useState(DEFAULT_L2_RPC);

  const [account, setAccount] = useState<Address>();
  const [sdk, setSdk] = useState<ViemSdk>();
  const [quote, setQuote] = useState<DepositQuote>();
  const [plan, setPlan] = useState<DepositPlan<unknown>>();
  const [handle, setHandle] = useState<DepositHandle<unknown>>();
  const [status, setStatus] = useState<DepositStatus>();
  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null);

  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<Action | null>(null);

  const [l2Rpc, setL2Rpc] = useState(DEFAULT_L2_RPC);
  const [amount, setAmount] = useState('0.01');
  const [token, setToken] = useState<Address>(ETH_ADDRESS);
  const [recipient, setRecipient] = useState('');
  const [l1GasLimitInput, setL1GasLimitInput] = useState('');
  const [l1MaxFeeInput, setL1MaxFeeInput] = useState('');
  const [l1PriorityFeeInput, setL1PriorityFeeInput] = useState('');

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

  const refreshSdkIfNeeded = useCallback(async (): Promise<ViemSdk> => {
    if (!provider || !account) throw new Error('Connect wallet first.');
    if (sdk && connectedL2Rpc === targetL2Rpc) return sdk;

    const transport = custom(provider);
    const l1Wallet = createWalletClient({ account, chain: sepolia, transport });

    const l2Client = createPublicClient({ transport: http(targetL2Rpc) });

    const client = createViemClient({
      l1: l1 as any,
      l2: l2Client as any,
      l1Wallet: l1Wallet as any,
    });

    const instance = createViemSdk(client);
    setSdk(instance);
    setConnectedL2Rpc(targetL2Rpc);
    return instance;
  }, [account, connectedL2Rpc, provider, sdk, targetL2Rpc]);

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

    const destination = (recipient.trim() || account) as Address;

    const overrides = {
      gasLimit: l1GasLimitInput.trim()
        ? parseOptionalBigInt(l1GasLimitInput, 'Gas limit')
        : undefined,
      maxFeePerGas: l1MaxFeeInput.trim()
        ? parseOptionalBigInt(l1MaxFeeInput, 'Max fee per gas')
        : undefined,
      maxPriorityFeePerGas: l1PriorityFeeInput.trim()
        ? parseOptionalBigInt(l1PriorityFeeInput, 'Max priority fee per gas')
        : undefined,
    };

    const hasOverrides =
      overrides.gasLimit != null ||
      overrides.maxFeePerGas != null ||
      overrides.maxPriorityFeePerGas != null;

    return {
      amount: parsedAmount,
      token,
      to: destination,
      ...(hasOverrides ? { l1TxOverrides: overrides } : {}),
    } as const;
  }, [account, amount, token, recipient, l1GasLimitInput, l1MaxFeeInput, l1PriorityFeeInput]);

  const handleConnected = useCallback(
    (address: Address) => {
      setAccount(address);
      setProvider(window.ethereum as EIP1193Provider);
      setConnectedL2Rpc(targetL2Rpc);
      setRecipient((prev) => prev || address);
      setQuote(undefined);
      setPlan(undefined);
      setHandle(undefined);
      setStatus(undefined);
      setReceipt(null);
    },
    [targetL2Rpc],
  );

  const connectWallet = useCallback(() => {
    if (!walletClient) {
      setError('No injected wallet found. Install MetaMask or another EIP-1193 wallet.');
      return;
    }
    return run(
      'connect',
      async () => {
        const [address] = await walletClient.requestAddresses();
        if (!address) throw new Error('Wallet returned no accounts.');
        return { address };
      },
      ({ address }) => handleConnected(address),
    );
  }, [handleConnected, run, walletClient]);

  const quoteDeposit = useCallback(
    () =>
      run(
        'quote',
        async () => {
          const currentSdk = await refreshSdkIfNeeded();
          const params = buildParams();
          const result = await currentSdk.deposits.tryQuote(params);
          if (!result.ok) throw result.error;
          return result.value;
        },
        (value) => setQuote(value),
      ),
    [buildParams, refreshSdkIfNeeded, run],
  );

  const prepareDeposit = useCallback(
    () =>
      run(
        'prepare',
        async () => {
          const currentSdk = await refreshSdkIfNeeded();
          const params = buildParams();
          const result = await currentSdk.deposits.tryPrepare(params);
          if (!result.ok) throw result.error;
          return result.value;
        },
        (value) => setPlan(value),
      ),
    [buildParams, refreshSdkIfNeeded, run],
  );

  const createDeposit = useCallback(
    () =>
      run(
        'create',
        async () => {
          const currentSdk = await refreshSdkIfNeeded();
          const params = buildParams();
          const result = await currentSdk.deposits.tryCreate(params);
          if (!result.ok) throw result.error;
          return result.value;
        },
        (value) => {
          setHandle(value);
          setStatus(undefined);
          setReceipt(null);
        },
      ),
    [buildParams, refreshSdkIfNeeded, run],
  );

  const checkStatus = useCallback(
    () =>
      run(
        'status',
        async () => {
          if (!handle) throw new Error('Create a deposit first.');
          const currentSdk = await refreshSdkIfNeeded();
          return currentSdk.deposits.status(handle);
        },
        (value) => setStatus(value),
      ),
    [handle, refreshSdkIfNeeded, run],
  );

  const waitForL2 = useCallback(
    () =>
      run(
        'waitL2',
        async () => {
          if (!handle) throw new Error('Create a deposit first.');
          const currentSdk = await refreshSdkIfNeeded();
          return currentSdk.deposits.wait(handle, { for: 'l2' });
        },
        (value) => setReceipt(value),
      ),
    [handle, refreshSdkIfNeeded, run],
  );

  const actionDisabled = (action: Action) => {
    if (busy && busy !== action) return true;
    if (!account && action !== 'connect') return true;
    return false;
  };

  return (
    <main>
      <h1>Viem Deposits (UI example)</h1>

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
        <h2>Deposit parameters</h2>
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
          <label>Token</label>
          <select value={token} onChange={(event) => setToken(event.target.value as Address)}>
            {TOKEN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Recipient (defaults to connected account)</label>
          <input
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder={account}
          />
        </div>

        <fieldset style={{ border: '1px solid #cbd5e1', borderRadius: '10px', padding: '1rem' }}>
          <legend>L1 overrides (wei, optional)</legend>
          <div className="inline-fields">
            <div className="field">
              <label>Gas limit</label>
              <input
                value={l1GasLimitInput}
                onChange={(event) => setL1GasLimitInput(event.target.value)}
                placeholder="Leave blank to auto-estimate"
              />
            </div>
            <div className="field">
              <label>Max fee per gas</label>
              <input
                value={l1MaxFeeInput}
                onChange={(event) => setL1MaxFeeInput(event.target.value)}
                placeholder="Leave blank to auto-estimate"
              />
            </div>
            <div className="field">
              <label>Max priority fee per gas</label>
              <input
                value={l1PriorityFeeInput}
                onChange={(event) => setL1PriorityFeeInput(event.target.value)}
                placeholder="Leave blank to auto-estimate"
              />
            </div>
          </div>
        </fieldset>
        {/* Removed preview sentence */}
      </section>

      <section>
        <h2>Actions</h2>
        <div className="inline-fields">
          <button onClick={quoteDeposit} disabled={actionDisabled('quote')}>
            {busy === 'quote' ? 'Quoting…' : 'Quote'}
          </button>
          <button onClick={prepareDeposit} disabled={actionDisabled('prepare')}>
            {busy === 'prepare' ? 'Preparing…' : 'Prepare'}
          </button>
          <button onClick={createDeposit} disabled={actionDisabled('create')}>
            {busy === 'create' ? 'Submitting…' : 'Create'}
          </button>
          <button onClick={checkStatus} disabled={actionDisabled('status') || !handle}>
            {busy === 'status' ? 'Checking…' : 'Status'}
          </button>
          <button onClick={waitForL2} disabled={actionDisabled('waitL2') || !handle}>
            {busy === 'waitL2' ? 'Waiting…' : 'Wait (L2)'}
          </button>
        </div>
      </section>

      <section className="results">
        <ResultCard title="Quote" data={quote} />
        <ResultCard title="Prepare" data={plan} />
        <ResultCard title="Create" data={handle} />
        <ResultCard title="Status" data={status} />
        <ResultCard title="Wait (L2)" data={receipt} />
      </section>

      {error && <div className="error">{error}</div>}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<Example />);
