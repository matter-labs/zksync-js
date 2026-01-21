# Security and Secrets

> **Never commit secrets. Keep examples safe.**

---

## Hard Rules

> [!CAUTION]
> Violations of these rules can compromise security.

### Never Commit

- Private keys
- API keys
- Tokens (JWT, OAuth, etc.)
- Passwords
- Private URLs
- Customer data
- Internal endpoints

### Always Check

Before committing, verify:

- [ ] No real private keys in code or tests
- [ ] No API keys or tokens
- [ ] No hardcoded URLs to internal/private services
- [ ] Example addresses are clearly fake or test addresses

---

## Safe Placeholders

Use these in examples and docs:

```typescript
// ✅ Safe placeholders
const PRIVATE_KEY = 'YOUR_PRIVATE_KEY_HERE';
const API_KEY = 'YOUR_API_KEY_HERE';
const RPC_URL = 'https://YOUR_RPC_ENDPOINT';

// ✅ Obviously fake values
const PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';
const ADDRESS = '0x0000000000000000000000000000000000000000';

// ✅ Environment variable references
const privateKey = process.env.PRIVATE_KEY!;
const rpcUrl = process.env.RPC_URL!;
```

### Don't Use

```typescript
// ❌ Real-looking keys (even if fake)
const PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

// ❌ Internal URLs
const RPC_URL = 'https://internal.matter-labs.io/rpc';

// ❌ Hardcoded credentials
const API_KEY = 'sk_live_1234567890abcdef';
```

---

## Test Data

For tests, use:

- Well-known test addresses (ZKsync testnet)
- Mock providers
- Local environment variables

```typescript
// Test addresses from .env.example or public test accounts
const TEST_ACCOUNT = process.env.TEST_ACCOUNT || '0x0000000000000000000000000000000000000000';
```

---

## If You Find a Secret

If you discover a committed secret:

1. Do NOT push any more commits
2. Notify maintainers immediately
3. The secret is compromised and must be rotated
