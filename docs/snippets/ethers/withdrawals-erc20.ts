// examples/withdrawals-erc20.ts
import { JsonRpcProvider, Wallet, parseUnits } from 'ethers';
import { createEthersClient, createEthersSdk } from '@matter-labs/zksync-js/ethers';

const L1_RPC = 'http://localhost:8545'; // e.g. https://sepolia.infura.io/v3/XXX
const L2_RPC = 'http://localhost:3050'; // your L2 RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Replace with a real **L2 ERC-20 token address** you hold on L2
const L1_ERC20_TOKEN = '0x42E331a2613Fd3a5bc18b47AE3F01e1537fD8873';

async function main() {
  const l1 = new JsonRpcProvider(L1_RPC);
  const l2 = new JsonRpcProvider(L2_RPC);
  const signer = new Wallet(PRIVATE_KEY, l1);

  const client = createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);

  const me = (await signer.getAddress());
  const l2Token = await sdk.helpers.l2TokenAddress(L1_ERC20_TOKEN);

  // Prepare withdraw params
  const params = {
    token: l2Token, // L2 ERC-20
    amount: parseUnits('25', 18), // withdraw 25 tokens
    to: me,
    // l2GasLimit: 300_000n,
  } as const;

  // -------- Dry runs / planning --------
  console.log('TRY QUOTE:', await sdk.withdrawals.tryQuote(params));
  console.log('QUOTE:', await sdk.withdrawals.quote(params));
  console.log('TRY PREPARE:', await sdk.withdrawals.tryPrepare(params));
  console.log('PREPARE:', await sdk.withdrawals.prepare(params));

  // -------- Create (L2 approvals if needed + withdraw) --------
  const created = await sdk.withdrawals.create(params);
  console.log('CREATE:', created);

  // Wait for L2 inclusion
  const l2Receipt = await sdk.withdrawals.wait(created, { for: 'l2' });
  console.log(
    'L2 included: block=',
    l2Receipt?.blockNumber,
    'status=',
    l2Receipt?.status,
    'hash=',
    l2Receipt?.hash,
  );

  console.log('STATUS (ready):', await sdk.withdrawals.status(created.l2TxHash));

  // Wait until the withdrawal is ready to finalize
  await sdk.withdrawals.wait(created.l2TxHash, { for: 'ready' });

  // Finalize on L1
  const fin = await sdk.withdrawals.tryFinalize(created.l2TxHash);
  if (!fin.ok) {
    console.error('FINALIZE failed:', fin.error);
    return;
  }
  console.log(
    'FINALIZE status:',
    fin.value.status,
    fin.value.receipt?.hash ?? '(already finalized)',
  );

  const l1Receipt = await sdk.withdrawals.wait(created.l2TxHash, { for: 'finalized' });
  if (l1Receipt) {
    console.log('L1 finalize receipt:', l1Receipt.hash);
  } else {
    console.log('Finalized (no local L1 receipt available, possibly finalized by another actor).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
