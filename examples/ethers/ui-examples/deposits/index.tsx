import { useCallback, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  BrowserProvider,
  JsonRpcProvider,
  type JsonRpcSigner,
  type TransactionReceipt,
  parseEther,
} from 'ethers';
import { createEthersClient, createEthersSdk, type EthersSdk } from '@matterlabs/zksync-js/ethers';
import {
  ETH_ADDRESS,
  L1_SOPH_TOKEN_ADDRESS,
  L2_BASE_TOKEN_ADDRESS,
} from '@matterlabs/zksync-js/core';
import type {
  DepositHandle,
  DepositPlan,
  DepositQuote,
  DepositStatus,
} from '@matterlabs/zksync-js/core';
import type { Address } from '../../../../src/core/types/primitives';

declare global {
  interface Window {
    ethereum?: import('ethers').Eip1193Provider;
  }
}

type Action = 'connect' | 'quote' | 'prepare' | 'create' | 'status' | 'waitL2';

const DEFAULT_L1_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const DEFAULT_L2_RPC = 'https://zksync-os-testnet-alpha.zksync.dev/';

const stringify = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

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
        <code>{stringify(data)}</code>
      </pre>
    </section>
  );
}

function Example() {
  const [account, setAccount] = useState<Address>();
  const [sdk, setSdk] = useState<EthersSdk>();
  const [l1Provider, setL1Provider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [connectedL2Rpc, setConnectedL2Rpc] = useState(DEFAULT_L2_RPC);

  const [quote, setQuote] = useState<DepositQuote>();
  const [plan, setPlan] = useState<DepositPlan<unknown>>();
  const [handle, setHandle] = useState<DepositHandle<unknown>>();
  const [status, setStatus] = useState<DepositStatus>();
  const [receipt, setReceipt] = useState<TransactionReceipt | null>();

  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<Action | null>(null);

  // Minimal inputs
  const [l2Rpc, setL2Rpc] = useState(DEFAULT_L2_RPC);
  const [amount, setAmount] = useState('0.01');
  const [token, setToken] = useState<Address>(ETH_ADDRESS);
  const [recipient, setRecipient] = useState('');
  const [l1GasLimitInput, setL1GasLimitInput] = useState(''); // leave blank to auto-estimate
  const [l1MaxFeeInput, setL1MaxFeeInput] = useState('');
  const [l1PriorityFeeInput, setL1PriorityFeeInput] = useState('');

  const targetL2Rpc = useMemo(() => l2Rpc.trim() || DEFAULT_L2_RPC, [l2Rpc]);

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

  const refreshSdkIfNeeded = useCallback(async (): Promise<EthersSdk> => {
    if (!l1Provider || !signer) throw new Error('Connect wallet first.');
    if (sdk && connectedL2Rpc === targetL2Rpc) return sdk;

    const l2Provider = new JsonRpcProvider(targetL2Rpc);
    const client = createEthersClient({ l1: l1Provider, l2: l2Provider, signer });
    const instance = createEthersSdk(client);

    setSdk(instance);
    setConnectedL2Rpc(targetL2Rpc);
    return instance;
  }, [connectedL2Rpc, l1Provider, sdk, signer, targetL2Rpc]);

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

  const connectWallet = useCallback(
    () =>
      run(
        'connect',
        async () => {
          if (!window.ethereum) {
            throw new Error('No injected wallet found. Install MetaMask or another wallet.');
          }

          const browserProvider = new BrowserProvider(window.ethereum);
          await browserProvider.send('eth_requestAccounts', []);
          const nextSigner = (await browserProvider.getSigner()) as JsonRpcSigner;
          const addr = (await nextSigner.getAddress()) as Address;

          const l2Provider = new JsonRpcProvider(targetL2Rpc);
          const client = createEthersClient({
            l1: browserProvider,
            l2: l2Provider,
            signer: nextSigner,
          });
          const instance = createEthersSdk(client);

          return { instance, browserProvider, signer: nextSigner, addr };
        },
        ({ instance, browserProvider, signer: nextSigner, addr }) => {
          setSdk(instance);
          setL1Provider(browserProvider);
          setSigner(nextSigner);
          setAccount(addr);
          setConnectedL2Rpc(targetL2Rpc);
          setRecipient((prev) => prev || addr);
          setQuote(undefined);
          setPlan(undefined);
          setHandle(undefined);
          setStatus(undefined);
          setReceipt(undefined);
        },
      ),
    [run, targetL2Rpc],
  );

  const actionDisabled = (action: Action, requiresHandle = false) => {
    if (busy && busy !== action) return true;
    if (!account && action !== 'connect') return true;
    if (requiresHandle && !handle) return true;
    return false;
  };

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
        setQuote,
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
        setPlan,
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
          setReceipt(undefined);
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
        setStatus,
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
        (value) => setReceipt(value ?? null),
      ),
    [handle, refreshSdkIfNeeded, run],
  );

  return (
    <main>
      <h1>Ethers Deposits (UI example)</h1>

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
          <button onClick={checkStatus} disabled={actionDisabled('status', true)}>
            {busy === 'status' ? 'Checking…' : 'Status'}
          </button>
          <button onClick={waitForL2} disabled={actionDisabled('waitL2', true)}>
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
