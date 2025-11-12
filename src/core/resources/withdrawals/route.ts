//core/withdrawals/route.ts
import type { WithdrawRoute } from '../../types/flows/withdrawals';
import { ETH_ADDRESS, L2_BASE_TOKEN_ADDRESS } from '../../constants';
import type { Address } from '../../types/primitives';

function normalizeTokenForRouting(token: Address): Address {
  const t = token.toLowerCase();
  if (t === ETH_ADDRESS.toLowerCase()) return L2_BASE_TOKEN_ADDRESS;
  return token;
}

// Only three routes: eth-base / eth-nonbase (for 0x…800A) and erc20-nonbase for everything else.
export function pickWithdrawRoute(args: { token: Address; baseIsEth: boolean }): WithdrawRoute {
  const tokenNorm = normalizeTokenForRouting(args.token);
  const isL2BaseAlias = tokenNorm.toLowerCase() === L2_BASE_TOKEN_ADDRESS.toLowerCase();
  if (isL2BaseAlias) return args.baseIsEth ? 'eth-base' : 'eth-nonbase';
  return 'erc20-nonbase';
}
