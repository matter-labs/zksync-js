/* eslint-disable no-console */
/**
 * Focused e2e probe for the v32 withdrawal path.
 *
 * Run against a live v32 stack (anvil on 8545 + zksync-os-server on 3050):
 *   bun run scripts/e2e-v32-withdrawal.ts
 *
 * Unlike the suite in `src/adapters/*​/e2e`, this reports *which* protocol was detected and by which
 * probe, so a wrong-protocol failure is distinguishable from a broken withdrawal.
 */
import { JsonRpcProvider, Wallet, NonceManager, Contract } from 'ethers';

import { createEthersClient } from '../src/adapters/ethers/client';
import { createEthersSdk } from '../src/adapters/ethers/sdk';
import { createWithdrawalProtocolService } from '../src/adapters/ethers/resources/withdrawals/services/protocol';
import { createFinalizationServices } from '../src/adapters/ethers/resources/withdrawals/services/finalization';
import {
  ETH_ADDRESS,
  L2_INTEROP_ATTRIBUTE_PARSER_ADDRESS,
  L2_INTEROP_CENTER_ADDRESS,
} from '../src/core/constants';
import { IL1NullifierV32ABI } from '../src/core/abi';
import type { Address, Hex } from '../src/core/types/primitives';

const L1_RPC = process.env.L1_RPC_URL ?? 'http://127.0.0.1:8545';
const L2_RPC = process.env.L2_RPC_URL ?? 'http://127.0.0.1:3050';
const PK =
  process.env.PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const L2_RICH_PK = '0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110';

const AMOUNT = 1_000_000_000_000_000n; // 0.001 ETH
const ATOMIC_FLOW_MANAGER = '0x0000000000000000000000000000000000010014' as Address;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(
    `${ok ? '  PASS' : '  FAIL'}  ${label}${detail === undefined ? '' : ` — ${String(detail)}`}`,
  );
  if (!ok) failures += 1;
}

async function main() {
  const l1 = new JsonRpcProvider(L1_RPC);
  const l2 = new JsonRpcProvider(L2_RPC);
  const signer = new NonceManager(new Wallet(PK, l1));
  const client = createEthersClient({ l1, l2, signer });
  const sdk = createEthersSdk(client);
  const me = (await signer.getAddress()) as Address;

  const l1ChainId = (await l1.getNetwork()).chainId;
  const l2ChainId = (await l2.getNetwork()).chainId;
  console.log(`\nL1 chain ${l1ChainId} @ ${L1_RPC}`);
  console.log(`L2 chain ${l2ChainId} @ ${L2_RPC}`);
  console.log(`account  ${me}\n`);

  // ---------------------------------------------------------------- detection
  console.log('[1] protocol detection');
  const version = await client.getChainProtocolVersion();
  console.log(`      getChainProtocolVersion() = ${version ? version.join('.') : 'undefined'}`);
  check('per-chain protocol version is readable', version !== undefined);
  check('reports v32 or later', !!version && version[1] >= 32, version?.join('.'));

  const svcProto = createWithdrawalProtocolService(client);
  const detection = await svcProto.detect();
  console.log(`      detect() = ${detection.protocol} via ${JSON.stringify(detection.source)}`);
  check("detects 'interop-bundle'", detection.protocol === 'interop-bundle');

  // Independently exercise the bytecode-probe fallback, which only runs when the version read
  // fails. Reported even when it disagrees: it tells us whether the sentinel holds on this chain.
  const parserCode = await l2.getCode(L2_INTEROP_ATTRIBUTE_PARSER_ADDRESS);
  const flowCode = await l2.getCode(ATOMIC_FLOW_MANAGER);
  console.log(
    `      code @ InteropAttributeParser 0x…010015 = ${parserCode === '0x' ? 'ABSENT' : `${(parserCode.length - 2) / 2} bytes`}`,
  );
  console.log(
    `      code @ AtomicFlowManager      0x…010014 = ${flowCode === '0x' ? 'ABSENT' : `${(flowCode.length - 2) / 2} bytes`}`,
  );
  const fallbackWouldWork = parserCode !== '0x';
  const forced = await createWithdrawalProtocolService(client, 'interop-bundle').detect();
  check('override short-circuits detection', forced.source.via === 'override');

  // ---------------------------------------------------------------- L1 surface
  console.log('\n[2] L1 v32 surface');
  const { l1Nullifier } = await client.ensureAddresses();
  console.log(`      l1Nullifier = ${l1Nullifier}`);
  const nullifier = new Contract(l1Nullifier, IL1NullifierV32ABI, l1);
  const handler = (await nullifier.l1InteropHandler()) as Address;
  console.log(`      l1InteropHandler() = ${handler}`);
  check(
    'nullifier exposes l1InteropHandler()',
    /^0x[0-9a-fA-F]{40}$/.test(handler) && handler !== '0x' + '0'.repeat(40),
  );

  const handlerCode = await l1.getCode(handler);
  check(
    'interop handler has code on L1',
    handlerCode !== '0x',
    `${(handlerCode.length - 2) / 2} bytes`,
  );

  // The legacy status read must be gone — this is what makes the old SDK path unusable.
  let legacyGone = false;
  try {
    const legacy = new Contract(
      l1Nullifier,
      ['function isWithdrawalFinalized(uint256,uint256,uint256) view returns (bool)'],
      l1,
    );
    await legacy.isWithdrawalFinalized(l2ChainId, 1, 0);
  } catch {
    legacyGone = true;
  }
  check('legacy isWithdrawalFinalized is gone (v32)', legacyGone);

  // ---------------------------------------------------------------- withdrawal
  console.log('\n[3] withdrawal lifecycle');
  const l2Bal = await l2.getBalance(me);
  if (l2Bal < AMOUNT * 3n) {
    console.log('      funding L2 account from the rich key…');
    const funder = new Wallet(L2_RICH_PK, l2);
    await (await funder.sendTransaction({ to: me, value: AMOUNT * 20n })).wait();
  }

  const quote = await sdk.withdrawals.quote({ token: ETH_ADDRESS, amount: AMOUNT, to: me });
  console.log(`      quote.route = ${quote.route}`);
  check("quote route is 'base'", quote.route === 'base');

  const plan = await sdk.withdrawals.prepare({ token: ETH_ADDRESS, amount: AMOUNT, to: me });
  const kinds = plan.steps.map((s) => s.kind);
  console.log(`      plan steps = ${JSON.stringify(kinds)}`);
  check('plan uses the interop-bundle step', kinds.includes('interop-center:send-bundle'));
  const sendStep = plan.steps.find((s) => s.kind === 'interop-center:send-bundle');
  check(
    'send targets the L2 InteropCenter',
    String((sendStep?.tx as { to?: string } | undefined)?.to).toLowerCase() ===
      L2_INTEROP_CENTER_ADDRESS.toLowerCase(),
  );
  check(
    'send forwards the withdrawn amount as value',
    BigInt(((sendStep?.tx as { value?: bigint } | undefined)?.value ?? 0n) as bigint) === AMOUNT,
  );

  const handle = await sdk.withdrawals.create({ token: ETH_ADDRESS, amount: AMOUNT, to: me });
  console.log(`      l2TxHash = ${handle.l2TxHash}`);
  check('create returned an L2 tx hash', /^0x[0-9a-fA-F]{64}$/.test(handle.l2TxHash));

  const l2Rcpt = await sdk.withdrawals.wait(handle, { for: 'l2' });
  check('L2 tx succeeded', (l2Rcpt as { status?: number } | null)?.status === 1);

  // Bundle-hash + inclusion proof derivation, once the batch is proven far enough for a proof.
  const svcFin = createFinalizationServices(client, svcProto);
  let resolved: Awaited<ReturnType<typeof svcFin.fetchFinalization>> | undefined;
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    try {
      resolved = await svcFin.fetchFinalization(handle.l2TxHash);
      break;
    } catch {
      await sleep(4000);
    }
  }
  if (!resolved) {
    check('fetchFinalization produced args within 10 min', false);
  } else {
    console.log(`      protocol   = ${resolved.finalization.protocol}`);
    console.log(`      target     = ${resolved.target}`);
    console.log(`      bundleHash = ${resolved.key.bundleHash}`);
    check(
      'finalization is tagged interop-bundle',
      resolved.finalization.protocol === 'interop-bundle',
    );
    check(
      'finalization targets the interop handler',
      resolved.target.toLowerCase() === handler.toLowerCase(),
    );
    check('bundleHash derived', /^0x[0-9a-fA-F]{64}$/.test(String(resolved.key.bundleHash)));

    if (resolved.finalization.protocol === 'interop-bundle') {
      const p = resolved.finalization.params;
      check(
        'bundle payload is non-empty',
        p.bundle.length > 2,
        `${(p.bundle.length - 2) / 2} bytes`,
      );
      check(
        'proof sender is the L2 InteropCenter',
        p.proof.message.sender.toLowerCase() === L2_INTEROP_CENTER_ADDRESS.toLowerCase(),
      );
      check(
        'merkle proof is non-empty',
        p.proof.proof.length > 0,
        `${p.proof.proof.length} siblings`,
      );
    }
  }

  console.log('\n[4] finalize on L1');
  const readyDeadline = Date.now() + 900_000;
  let phase = '';
  while (Date.now() < readyDeadline) {
    const st = await sdk.withdrawals.status(handle.l2TxHash);
    if (st.phase !== phase) {
      phase = st.phase;
      console.log(`      phase -> ${phase}`);
    }
    if (phase === 'READY_TO_FINALIZE' || phase === 'FINALIZED') break;
    await sleep(4000);
  }
  check('reached READY_TO_FINALIZE', phase === 'READY_TO_FINALIZE' || phase === 'FINALIZED', phase);

  if (phase === 'READY_TO_FINALIZE' || phase === 'FINALIZED') {
    const l1Before = await l1.getBalance(me);
    const res = await sdk.withdrawals.finalize(handle.l2TxHash as Hex);
    console.log(`      finalize -> ${res.status.phase} (tx ${res.receipt?.hash ?? 'n/a'})`);
    check('withdrawal is FINALIZED', res.status.phase === 'FINALIZED');

    const l1After = await l1.getBalance(me);
    console.log(
      `      L1 balance delta = ${l1After - l1Before} wei (amount ${AMOUNT}, minus L1 gas)`,
    );
    check('L1 balance moved', l1After !== l1Before);

    // Idempotence: a second finalize must observe FINALIZED via bundleStatus, not resend.
    const again = await sdk.withdrawals.finalize(handle.l2TxHash as Hex);
    check(
      'second finalize is a no-op reporting FINALIZED',
      again.status.phase === 'FINALIZED' && !again.receipt,
    );
  }

  console.log('\n----------------------------------------');
  console.log(
    `fallback sentinel (0x…010015) present on this chain: ${fallbackWouldWork ? 'YES' : 'NO'}`,
  );
  console.log(failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nFATAL', e);
  process.exit(1);
});
