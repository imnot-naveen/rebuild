import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AccessClient {
  private readonly baseUrl = process.env.ACCESS_URL?.trim();
  private readonly key = process.env.ACCESS_INTERNAL_KEY?.trim();

  async requireResident(eventId: string, authorization?: string): Promise<string> {
    if (!authorization) {
      throw new UnauthorizedException('A bearer access token is required');
    }
    if (!this.baseUrl || !this.key) {
      throw new ServiceUnavailableException('Access is unavailable');
    }

    const response = await fetch(new URL(`/internal/events/${eventId}/actor`, this.baseUrl), {
      headers: { authorization, 'x-access-key': this.key },
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      throw new ServiceUnavailableException('Access is unavailable');
    });
    if (response.status === 401) {
      await response.body?.cancel();
      throw new UnauthorizedException('Authentication failed');
    }
    if (response.status === 403) {
      await response.body?.cancel();
      throw new ForbiddenException('Resident event membership is required');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ServiceUnavailableException('Access is unavailable');
    }

    const actor: unknown = await response.json().catch(() => null);
    if (
      !actor || typeof actor !== 'object' ||
      !('userId' in actor) || typeof actor.userId !== 'string' || !uuidPattern.test(actor.userId) ||
      !('role' in actor) || typeof actor.role !== 'string' ||
      !['resident', 'coordinator', 'volunteer'].includes(actor.role)
    ) {
      throw new ServiceUnavailableException('Access returned an invalid actor');
    }
    if (actor.role !== 'resident') {
      throw new ForbiddenException('Resident event membership is required');
    }
    return actor.userId;
  }
}
