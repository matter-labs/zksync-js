/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import type { Address, Chain, Hex, Transport, Account } from 'viem';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemClient } from '../../client.ts';
import { createViemSdk } from '../../sdk.ts';

export const PRIVIDIUM_BRIDGE_ROLE = 'bridge-user';

type SiweChallenge = {
  msg: string;
  nonceToken: string;
};

type AuthResponse = {
  token: string;
};

export type PrividiumProfile = {
  roles: Array<{ roleName: string }>;
  wallets: Array<{ walletAddress: Address }>;
};

const L1_RPC_URL = env('L1_RPC_URL');
const PRIVIDIUM_RPC_URL = env('PRIVIDIUM_RPC_URL');
const PRIVIDIUM_API_URL = env('PRIVIDIUM_API_URL').replace(/\/$/, '');
const PRIVIDIUM_PRIVATE_KEY = env('PRIVIDIUM_PRIVATE_KEY') as Hex;

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

async function postJson<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(`${PRIVIDIUM_API_URL}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(token ? authHeaders(token) : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`POST ${path} failed with ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}

async function getJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${PRIVIDIUM_API_URL}${path}`, {
    headers: {
      accept: 'application/json',
      ...authHeaders(token),
    },
  });

  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}

export async function loginPrividiumUser(): Promise<{ token: string; address: Address }> {
  const account = privateKeyToAccount(PRIVIDIUM_PRIVATE_KEY);
  const challenge = await postJson<SiweChallenge>('/api/siwe-messages', {
    address: account.address,
    domain: 'localhost:3001',
  });
  const signature = await account.signMessage({ message: challenge.msg });
  const auth = await postJson<AuthResponse>('/api/auth/login/crypto-native', {
    message: challenge.msg,
    signature,
    nonceToken: challenge.nonceToken,
  });

  return { token: auth.token, address: account.address };
}

export function createPrividiumClientAndSdk(token: string) {
  const account: Account = privateKeyToAccount(PRIVIDIUM_PRIVATE_KEY);
  const l2Transport = http(PRIVIDIUM_RPC_URL, {
    fetchOptions: {
      headers: authHeaders(token),
    },
  });

  const l1 = createPublicClient({
    transport: http(L1_RPC_URL),
  });
  const l2 = createPublicClient({
    transport: l2Transport,
  });
  const l1Wallet = createWalletClient<Transport, Chain, Account>({
    account,
    transport: http(L1_RPC_URL),
  });
  const l2Wallet = createWalletClient<Transport, Chain, Account>({
    account,
    transport: l2Transport,
  });

  const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
  const sdk = createViemSdk(client);
  return { client, sdk };
}

export async function fetchPrividiumProfile(token: string): Promise<PrividiumProfile> {
  return getJson<PrividiumProfile>('/api/profiles/me', token);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForL1Inclusion(sdk: any, handle: any, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await sdk.deposits.status(handle);
    if (status.phase !== 'L1_PENDING' && status.phase !== 'UNKNOWN') {
      return status;
    }
    await sleep(1500);
  }
  throw new Error('Timed out waiting for L1 inclusion through Prividium.');
}

export async function waitForL2InclusionWithdraw(sdk: any, handle: any, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const status = await sdk.withdrawals.status(handle);
      if (status.phase !== 'L2_PENDING' && status.phase !== 'UNKNOWN') {
        return status;
      }
    } catch (error: unknown) {
      const errorMessage = (error as { message?: unknown }).message;
      const message = typeof errorMessage === 'string' ? errorMessage : '';
      if (!message.includes('TransactionReceiptNotFoundError')) {
        throw error;
      }
    }
    await sleep(1500);
  }
  throw new Error('Timed out waiting for L2 withdrawal inclusion through Prividium.');
}
