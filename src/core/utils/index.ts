export * from './hash';
export * from './number';
export * from './addr';

// Pause execution for a specified duration
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exhaustiveness helper for discriminated unions
export function assertNever(x: never): never {
  throw new Error('Unexpected action type: ' + String(x));
}
