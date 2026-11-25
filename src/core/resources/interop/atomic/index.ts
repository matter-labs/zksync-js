// src/core/resources/interop/atomic/index.ts
//
// Atomic interop helpers. The legs of an atomic flow are interop bundles, each sent on its source
// chain with the `atomicBundle` attribute, which commits the leg to the flow id in that chain's
// commitment tree. Either every leg is proven committed in a batch the settlement layer included by
// the deadline, and each destination executes its leg with `executeAtomicBundle`; or one leg is
// proven absent past the deadline, and each committed leg is refunded with `authorizeRefund` and
// `claimRefund`.
export * from './flow';
export * from './proof';
export * from './helpers';
