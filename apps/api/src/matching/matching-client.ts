import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { MatchCandidate, MatchSnapshot, RankedCandidate } from './snapshot';

@Injectable()
export class MatchingClient {
  private readonly baseUrl = process.env.MATCHING_URL?.trim();
  private readonly key = process.env.MATCHING_INTERNAL_KEY?.trim();

  async rank(snapshot: MatchSnapshot) {
    if (snapshot.candidates.length === 0) return { policyVersion: null, candidates: [] };

    const unavailable = new ServiceUnavailableException('Stock suggestions are temporarily unavailable');
    if (!this.baseUrl || !this.key) throw unavailable;
    try {
      const response = await fetch(new URL('/internal/matching/rank', this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-matching-key': this.key },
        body: JSON.stringify(snapshot),
        redirect: 'error',
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw unavailable;
      }
      const ranking = readRanking(await response.json(), snapshot);
      if (ranking) return ranking;
    } catch {
      throw unavailable;
    }
    throw unavailable;
  }
}

function readRanking(body: unknown, { allocatableQuantity, candidates }: MatchSnapshot) {
  if (!body || typeof body !== 'object' || !('policyVersion' in body) ||
      typeof body.policyVersion !== 'string' || !/^[a-z0-9-]{1,64}$/.test(body.policyVersion) ||
      !('candidates' in body) || !Array.isArray(body.candidates) || body.candidates.length !== candidates.length) {
    return;
  }

  const pending = new Map(candidates.map((candidate) => [candidate.lotId, candidate]));
  const ranked: (RankedCandidate & MatchCandidate)[] = [];
  for (const item of body.candidates as unknown[]) {
    if (!item || typeof item !== 'object' || !('lotId' in item) || typeof item.lotId !== 'string') return;
    const source = pending.get(item.lotId);
    if (!source || !('coveredQuantity' in item) ||
        typeof item.coveredQuantity !== 'number' ||
        item.coveredQuantity !== Math.min(allocatableQuantity, source.availableQuantity) ||
        !('explanation' in item) || typeof item.explanation !== 'string' ||
        !item.explanation.trim() || item.explanation.length > 200) return;

    pending.delete(item.lotId);
    ranked.push({ ...source, coveredQuantity: item.coveredQuantity, explanation: item.explanation });
  }
  return { policyVersion: body.policyVersion, candidates: ranked };
}
