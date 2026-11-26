import { BadRequestException, ConflictException } from '@nestjs/common';
import { parsePositiveQuantity, requiredText } from '../operations/input';

export const assignmentStates = ['assigned', 'accepted', 'in_transit', 'completed', 'cancelled'] as const;
export type AssignmentState = typeof assignmentStates[number];

export type AssignmentCommand =
  | { action: 'acceptance' | 'transit'; version: number }
  | { action: 'deliveries'; version: number; quantity: number }
  | { action: 'cancellation'; version: number; reason: string };

export function parseAssignmentCommand(action: AssignmentCommand['action'], body: unknown): AssignmentCommand {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Expected an assignment command object');
  }
  const fields = body as Record<string, unknown>;
  const version = parsePositiveQuantity(fields.version, 'Assignment version');
  if (action === 'deliveries') return { action, version, quantity: parsePositiveQuantity(fields.quantity) };
  if (action === 'cancellation') return { action, version, reason: requiredText(fields.reason, 'Reason', 2000) };
  return { action, version };
}

export function nextAssignmentState(
  command: AssignmentCommand,
  current: { version: number; state: AssignmentState; assignedQuantity: number; deliveredQuantity: number },
): AssignmentState {
  if (command.version !== current.version) {
    throw new ConflictException({
      code: 'STALE_VERSION', message: 'The assignment version has changed', details: { version: current.version },
    });
  }

  const { state } = current;
  if (command.action === 'acceptance' && state === 'assigned') return 'accepted';
  if (command.action === 'transit' && state === 'accepted') return 'in_transit';
  if (command.action === 'cancellation' && isActiveAssignment(state)) return 'cancelled';
  if (command.action === 'deliveries' && state === 'in_transit') {
    const remainingQuantity = current.assignedQuantity - current.deliveredQuantity;
    if (command.quantity > remainingQuantity) {
      throw new ConflictException({
        code: 'INSUFFICIENT_RESERVATION', message: 'The assignment holds less than this delivery quantity',
        details: { remainingQuantity },
      });
    }
    return command.quantity === remainingQuantity ? 'completed' : 'in_transit';
  }
  throw new ConflictException({ code: 'INVALID_TRANSITION', message: 'This action is unavailable in the current assignment state' });
}

function isActiveAssignment(state: AssignmentState) {
  return state === 'assigned' || state === 'accepted' || state === 'in_transit';
}
