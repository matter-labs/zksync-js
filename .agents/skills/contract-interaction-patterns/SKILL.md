---
name: contract-interaction-patterns
description: Use this skill when changing ABI sources/registry, contract clients/wrappers, calldata construction, contract method calls, event/log decoding, or any SDK behavior directly derived from ABI definitions. Do not use this skill for unrelated utilities, docs formatting, CI/release config, or non-contract refactors.
---

# Contract Interaction Patterns

Use this skill for ABI-facing SDK work only.

## Activation Scope (Tight)

Use this skill when the diff touches these paths and ABI-facing behavior is involved:

- `src/core/internal/abis/**`
- `src/core/abi.ts`
- `src/adapters/*/client.ts`
- `src/adapters/*/resources/contracts/**`
- `src/adapters/**/*decoders*`
- `src/adapters/**/*topics*`
- `src/adapters/*/errors/revert.ts`
- `src/core/utils/events.ts` (when event parsing logic changes)
- `src/core/resources/**/logs.ts` (when log decode/index logic changes)

Also use it when code changes do any of the following:

- calls contract methods
- builds calldata
- decodes contract events/logs
- maps ABI definitions into SDK methods/types

Do not use this skill for incidental non-contract edits in nearby files.

## Contract API Correctness Rules

1. Never invent contract methods or events.

- Verify symbol names against ABI files before proposing wrapper changes.

2. Wrapper/API changes must reference exact ABI names.

- Every proposed wrapper change must cite the ABI function/event name it maps to.

3. ABI/interface changes require ripple mapping.

- Evaluate impact across wrappers, types, tests, and docs.
- If impact is none, state why explicitly.

4. ABI-driven does not mean "expose everything."

- If an ABI method exists but should not be exposed (admin-only, unsafe, out-of-scope), document rationale and policy alignment.

## Call vs Transaction Patterns

1. Follow established adapter-specific patterns in the closest analogous implementation.

- Cite the file path used as precedent in your output.

2. Read-only interactions:

- Use adapter-native read mechanisms already used in that area.

3. State-changing interactions:

- Use adapter-native send/write flow used in adjacent code.
- Include receipt/wait handling consistent with existing services.

4. Avoid imposing one universal flow across the entire repo.

- If local patterns vary, follow the local established variant and document it.

5. Keep adapter mechanics inside adapters.

- `src/core` remains adapter-agnostic.

## Address, Chain, and Network Configuration

1. Resolve addresses through existing client/resource flows (`ensureAddresses()`, `contracts()`).
2. Use `src/core/constants.ts` for canonical system addresses unless explicit overrides are part of existing client initialization.
3. Source chain IDs from existing provider/client methods used in current contexts.
4. Reuse core address helpers when validating/normalizing external addresses.

## Events and Logs

1. Never duplicate decoding logic if a helper already exists.

- Search for existing decoder/topic helpers first and extend them.

2. If adding a new decoder/helper is necessary:

- justify why existing helpers are insufficient
- keep scope minimal and adapter-appropriate

3. Keep topic/index assumptions aligned with existing constants and helper behavior.

## Adapter Parity Requirements

1. ABI-facing behavior added in one adapter requires parity assessment in the other adapter.
2. Allowed exception must be explicit in PR notes with rationale, scope, and consumer impact.
3. Document exceptions following existing contributor contracts in `llm/resource-patterns.md` and `llm/change-playbook.md`.

## Generated Artifacts Rule

1. Never hand-edit:

- `src/adapters/ethers/typechain/**`
- `typechain/**`

2. If ABI changes affect ethers TypeChain inputs:

- run `bun run types`
- include generated diffs in the same PR

3. If ABI changes do not require regeneration:

- state why explicitly (for example: registry-only alias updates or viem/raw-ABI-only path)

## Invocation Output Contract

When invoked, always output:

1. ABI files involved (full paths)
2. Contract methods/events touched (exact names)
3. Wrapper/API change summary
4. Ripple map (wrappers, services, tests, docs)
5. Adapter impact (`ethers`, `viem`, or both)
6. Compatibility risk (`breaking`, `behavior-change`, `additive`, `internal-only`)
7. Decoder/helper reuse:

- existing helper reused (path), or
- justification for new helper

8. Verification commands (exact Bun commands)
9. Required docs updates (or explicit `none`)

## Verification Commands

- `bun run lint`
- `bun run format:check`
- `bun run typecheck`
- `bun run test`
- `bun run test:e2e:ethers` (when ethers adapter behavior changed)
- `bun run test:e2e:viem` (when viem adapter behavior changed)
- `bun run docs:build` (when `AGENTS.md`, `llm/**`, or docs files changed)

## References

- `AGENTS.md`
- `llm/architecture-adapters-and-core.md`
- `llm/change-playbook.md`
- `llm/testing-and-quality.md`
- `llm/resource-patterns.md`
- `llm/public-api-contract.md`
- `src/core/internal/abis/**`
- `src/core/abi.ts`
