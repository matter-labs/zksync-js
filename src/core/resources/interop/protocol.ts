// src/core/resources/interop/protocol.ts
import { createError } from '../../errors/factory';
import { OP_INTEROP } from '../../types/errors';
import type { ProtocolVersion } from '../../types/primitives';

export const MIN_INTEROP_PROTOCOL = 31;

export function assertProtocolVersion(chainId: bigint, protocolVersion: ProtocolVersion): void {
  if (protocolVersion[1] < MIN_INTEROP_PROTOCOL) {
    throw createError('VALIDATION', {
      resource: 'interop',
      operation: OP_INTEROP.context.protocolVersion,
      message: `Interop requires protocol version 31.0+. Found: ${protocolVersion[1]}.${protocolVersion[2]} for chain: ${chainId}.`,
      context: {
        chainId,
        requiredMinor: MIN_INTEROP_PROTOCOL,
        semver: protocolVersion,
      },
    });
  }
}
