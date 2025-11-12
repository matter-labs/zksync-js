/**
 * Example: Fetch the L2 genesis configuration via `zks_getGenesis`.
 *
 * Flow:
 * 1. Configure an L2 JSON-RPC endpoint (default: public testnet).
 * 2. Create a Viem public client.
 * 3. Wrap the client with the SDK’s `zks` helper.
 * 4. Call `getGenesis()` and print a quick summary.
 */

import { createPublicClient, http } from 'viem';

import { zksRpcFromViem } from '../../src/adapters/viem/rpc';

async function main() {
  // Replace with your own endpoint
  const l2Rpc = process.env.L2_RPC_URL ?? 'https://zksyncos-testnet';

  const l2Client = createPublicClient({ transport: http(l2Rpc) });
  const zks = zksRpcFromViem(l2Client);

  const genesis = await zks.getGenesis();

  console.log('--- zks_getGenesis -------------------------------------------------');
  console.log('Execution version:', genesis.executionVersion);
  console.log('Genesis root     :', genesis.genesisRoot);
  console.log('Initial contracts:', genesis.initialContracts.length);
  console.log('Additional storage entries:', genesis.additionalStorage.length);

  if (genesis.initialContracts.length > 0) {
    console.log('\nFirst contract:');
    const first = genesis.initialContracts[0];
    console.log('  address :', first.address);
    console.log('  bytecode:', `${first.bytecode.slice(0, 66)}...`);
  }

  if (genesis.additionalStorage.length > 0) {
    console.log('\nFirst storage entry:');
    const entry = genesis.additionalStorage[0];
    console.log('  key  :', entry.key);
    console.log('  value:', entry.value);
  }

  console.log('--------------------------------------------------------------------');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
