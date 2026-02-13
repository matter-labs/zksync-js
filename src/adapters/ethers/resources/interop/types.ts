import type { AbstractProvider } from 'ethers';
import type {
  InteropParams as InteropParamsBase,
  InteropHandle as InteropHandleBase,
  InteropWaitable as InteropWaitableBase,
  InteropFinalizationInfo as InteropFinalizationInfoBase,
} from '../../../../core/types/flows/interop';

export type DstChain = string | AbstractProvider;

export interface InteropParams extends InteropParamsBase {
  dstChain: DstChain;
}

export interface InteropHandle<Tx> extends InteropHandleBase<Tx> {
  dstChain: DstChain;
}

export interface InteropFinalizationInfo extends InteropFinalizationInfoBase {
  dstChain: DstChain;
}

export type InteropWaitable =
  | InteropHandle<unknown>
  | { dstChain: DstChain; waitable: InteropWaitableBase };
