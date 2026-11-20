import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RequestReader {
  userId: string;
  role: 'resident' | 'coordinator';
}

export type VolunteerEligibility = 'eligible' | 'ineligible' | 'unavailable';

@Injectable()
export class AccessClient {
  private readonly baseUrl = process.env.ACCESS_URL?.trim();
  private readonly key = process.env.ACCESS_INTERNAL_KEY?.trim();

  async requireResident(eventId: string, authorization?: string): Promise<string> {
    return this.requireRole('resident', eventId, authorization);
  }

  async requireCoordinator(eventId: string, authorization?: string): Promise<string> {
    return this.requireRole('coordinator', eventId, authorization);
  }

  private async requireRole(role: RequestReader['role'], eventId: string, authorization?: string): Promise<string> {
    const forbiddenMessage = role === 'resident'
      ? 'Resident event membership is required'
      : 'Coordinator event membership is required';
    const actor = await this.resolveActor(eventId, forbiddenMessage, authorization);
    if (actor.role !== role) {
      throw new ForbiddenException(forbiddenMessage);
    }
    return actor.userId;
  }

  async requireRequestReader(eventId: string, authorization?: string): Promise<RequestReader> {
    const forbiddenMessage = 'Resident or coordinator event membership is required';
    const actor = await this.resolveActor(eventId, forbiddenMessage, authorization);
    if (actor.role === 'volunteer') {
      throw new ForbiddenException(forbiddenMessage);
    }
    return { userId: actor.userId, role: actor.role };
  }

  async volunteerEligibility(eventId: string, volunteerId: string): Promise<VolunteerEligibility> {
    const response = await this.fetchInternal(`/internal/events/${eventId}/volunteers/${volunteerId}`).catch(() => null);
    if (!response?.ok) {
      await response?.body?.cancel().catch(() => undefined);
      return 'unavailable';
    }
    const body: unknown = await response.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('eligible' in body) || typeof body.eligible !== 'boolean') {
      return 'unavailable';
    }
    return body.eligible ? 'eligible' : 'ineligible';
  }

  private async resolveActor(
    eventId: string,
    forbiddenMessage: string,
    authorization?: string,
  ): Promise<{ userId: string; role: RequestReader['role'] | 'volunteer' }> {
    if (!authorization) {
      throw new UnauthorizedException('A bearer access token is required');
    }
    const response = await this.fetchInternal(`/internal/events/${eventId}/actor`, { authorization });
    if (response.status === 401) {
      await response.body?.cancel();
      throw new UnauthorizedException('Authentication failed');
    }
    if (response.status === 403) {
      await response.body?.cancel();
      throw new ForbiddenException(forbiddenMessage);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ServiceUnavailableException('Access is unavailable');
    }

    const actor: unknown = await response.json().catch(() => null);
    if (
      !actor || typeof actor !== 'object' ||
      !('userId' in actor) || typeof actor.userId !== 'string' || !uuidPattern.test(actor.userId) ||
      !('role' in actor) ||
      (actor.role !== 'resident' && actor.role !== 'coordinator' && actor.role !== 'volunteer')
    ) {
      throw new ServiceUnavailableException('Access returned an invalid actor');
    }
    return { userId: actor.userId, role: actor.role };
  }

  private async fetchInternal(path: string, headers?: Record<string, string>): Promise<Response> {
    if (!this.baseUrl || !this.key) {
      throw new ServiceUnavailableException('Access is unavailable');
    }
    try {
      return await fetch(new URL(path, this.baseUrl), {
        headers: { ...headers, 'x-access-key': this.key },
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      throw new ServiceUnavailableException('Access is unavailable');
    }
  }
}
