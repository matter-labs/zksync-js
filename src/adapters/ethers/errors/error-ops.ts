// src/adapters/ethers/errors/error-ops.ts
import { createErrorOps } from '../../../core/errors/error-ops';
import { decodeRevert } from './revert';

const { toZKsyncError, createErrorHandlers } = createErrorOps(decodeRevert);

export { toZKsyncError, createErrorHandlers };
