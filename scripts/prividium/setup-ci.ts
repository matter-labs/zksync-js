import { getAddress, toFunctionSelector, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const BRIDGE_ROLE = 'bridge-user';
const L2_BASE_TOKEN_ADDRESS = '0x000000000000000000000000000000000000800A';
const L2_NATIVE_TOKEN_VAULT_ADDRESS = '0x0000000000000000000000000000000000010004';

type Role = {
  roleName: string;
  systemPermissions: string[];
};

type Wallet = {
  walletAddress: Address;
};

type User = {
  id: string;
  displayName: string;
  roles: Array<{ roleName: string }>;
  wallets: Wallet[];
};

type Paginated<T> = {
  items: T[];
};

type SiweChallenge = {
  msg: string;
  nonceToken: string;
};

type AuthResponse = {
  token: string;
};

type ContractPermission = {
  id: number;
  contractAddress: Address;
  methodSelector: Hex;
  accessType: 'read' | 'write';
  functionSignature: string;
  ruleType: 'public' | 'checkRole';
  roles?: Array<{ roleName: string }>;
  isUmbrella?: boolean;
};

type PermissionInput = {
  contractAddress: Address;
  functionSignature: string;
  accessType: 'read' | 'write';
  ruleType: 'public' | 'checkRole';
  roles?: Array<{ roleName: string }>;
};

const apiUrl = env('PRIVIDIUM_API_URL').replace(/\/$/, '');
const adminPrivateKey = env('PRIVIDIUM_ADMIN_PRIVATE_KEY') as Hex;
const testPrivateKey = env('PRIVIDIUM_PRIVATE_KEY') as Hex;
const testAccount = privateKeyToAccount(testPrivateKey);

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    ok?: number[];
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const ok = options.ok ?? [200];
  if (!ok.includes(response.status)) {
    const text = await response.text();
    throw new Error(`${options.method ?? 'GET'} ${path} failed with ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function requestMaybe<T>(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {},
): Promise<T | undefined> {
  const headers: Record<string, string> = {
    accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 404) {
    return undefined;
  }

  if (response.status < 200 || response.status >= 300) {
    const text = await response.text();
    throw new Error(`${options.method ?? 'GET'} ${path} failed with ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

async function login(privateKey: Hex): Promise<string> {
  const account = privateKeyToAccount(privateKey);
  const challenge = await request<SiweChallenge>('/api/siwe-messages', {
    method: 'POST',
    body: {
      address: account.address,
      domain: 'localhost:3001',
    },
  });
  const signature = await account.signMessage({ message: challenge.msg });
  const auth = await request<AuthResponse>('/api/auth/login/crypto-native', {
    method: 'POST',
    body: {
      message: challenge.msg,
      signature,
      nonceToken: challenge.nonceToken,
    },
  });
  return auth.token;
}

async function ensureRole(token: string): Promise<void> {
  const existing = await requestMaybe<Role>(`/api/roles/${encodeURIComponent(BRIDGE_ROLE)}`, {
    token,
  });

  const body = {
    roleName: BRIDGE_ROLE,
    systemPermissions: [],
  };

  if (!existing) {
    await request<Role>('/api/roles', {
      method: 'POST',
      token,
      body,
      ok: [201],
    });
    return;
  }

  if (existing.systemPermissions.length !== 0) {
    await request<Role>(`/api/roles/${encodeURIComponent(BRIDGE_ROLE)}`, {
      method: 'PUT',
      token,
      body,
    });
  }
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function ensureBridgeUser(token: string): Promise<void> {
  const users = await request<Paginated<User>>('/api/users?limit=1000&offset=0', { token });
  const existing = users.items.find((user) =>
    user.wallets.some((wallet) => sameAddress(wallet.walletAddress, testAccount.address)),
  );

  const body = {
    displayName: 'Prividium SDK bridge user',
    roles: [BRIDGE_ROLE],
    wallets: [testAccount.address],
  };

  if (!existing) {
    await request<User>('/api/users', {
      method: 'POST',
      token,
      body,
      ok: [201],
    });
    return;
  }

  const hasRole = existing.roles.some((role) => role.roleName === BRIDGE_ROLE);
  const hasWallet = existing.wallets.some((wallet) =>
    sameAddress(wallet.walletAddress, testAccount.address),
  );
  if (
    existing.displayName !== body.displayName ||
    !hasRole ||
    !hasWallet ||
    existing.roles.length !== 1
  ) {
    await request<User>(`/api/users/${encodeURIComponent(existing.id)}`, {
      method: 'PUT',
      token,
      body,
    });
  }
}

async function ensurePermission(token: string, input: PermissionInput): Promise<void> {
  const methodSelector = toFunctionSelector(input.functionSignature);
  const contractAddress = getAddress(input.contractAddress);
  const params = new URLSearchParams({
    contractAddress,
    methodSelector,
    limit: '1000',
    offset: '0',
  });
  const existing = await request<Paginated<ContractPermission>>(
    `/api/contract-permissions?${params}`,
    {
      token,
    },
  );

  const body = {
    contractAddress,
    methodSelector,
    accessType: input.accessType,
    functionSignature: input.functionSignature,
    ruleType: input.ruleType,
    isUmbrella: false,
    roles: input.roles ?? [],
  };

  const [permission] = existing.items;
  if (!permission) {
    await request<ContractPermission>('/api/contract-permissions', {
      method: 'POST',
      token,
      body,
      ok: [201],
    });
    return;
  }

  await request<ContractPermission>(`/api/contract-permissions/${permission.id}`, {
    method: 'PUT',
    token,
    body: {
      ...body,
      id: permission.id,
    },
  });
}

async function main() {
  const adminToken = await login(adminPrivateKey);

  await ensureRole(adminToken);
  await ensureBridgeUser(adminToken);

  for (const functionSignature of [
    'function L1_CHAIN_ID()',
    'function BASE_TOKEN_ASSET_ID()',
    'function WETH_TOKEN()',
    'function originChainId(bytes32)',
  ]) {
    await ensurePermission(adminToken, {
      contractAddress: L2_NATIVE_TOKEN_VAULT_ADDRESS,
      functionSignature,
      accessType: 'read',
      ruleType: 'public',
    });
  }

  await ensurePermission(adminToken, {
    contractAddress: L2_BASE_TOKEN_ADDRESS,
    functionSignature: 'function withdraw(address)',
    accessType: 'write',
    ruleType: 'checkRole',
    roles: [{ roleName: BRIDGE_ROLE }],
  });

  console.log(`Configured Prividium bridge permissions for ${testAccount.address}`);
}

await main();
