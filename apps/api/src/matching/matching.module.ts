import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Module,
  NotFoundException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { parsePositiveQuantity, parseUuid } from '../operations/input';
import { rankLots } from './rank';
import { matchCandidateLimit, matchRadiusMetres, type MatchSnapshot } from './snapshot';

function parseSnapshot(body: unknown): MatchSnapshot {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Expected a matching snapshot');
  }
  const fields = body as Record<string, unknown>;
  const allocatableQuantity = parsePositiveQuantity(fields.allocatableQuantity, 'Allocatable quantity');
  if (!Array.isArray(fields.candidates) || fields.candidates.length > matchCandidateLimit) {
    throw new BadRequestException(`Expected at most ${matchCandidateLimit} candidates`);
  }
  const seen = new Set<string>();
  const candidates = fields.candidates.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new BadRequestException('Expected a candidate object');
    }
    const item = candidate as Record<string, unknown>;
    const lotId = parseUuid(item.lotId, 'A valid stock lot ID is required');
    if (seen.has(lotId)) throw new BadRequestException('Stock lot IDs must be unique');
    seen.add(lotId);
    const { distanceMetres } = item;
    if (typeof distanceMetres !== 'number' || !Number.isFinite(distanceMetres) ||
        distanceMetres < 0 || distanceMetres > matchRadiusMetres) {
      throw new BadRequestException('Candidate distance is outside the matching radius');
    }
    return { lotId, distanceMetres, availableQuantity: parsePositiveQuantity(item.availableQuantity, 'Available quantity') };
  });
  return { allocatableQuantity, candidates };
}

@Controller('internal/matching')
class MatchingController {
  private readonly sharedKey = process.env.MATCHING_INTERNAL_KEY?.trim();

  @Post('rank')
  @HttpCode(200)
  rank(@Headers('x-matching-key') key: string | undefined, @Body() body: unknown) {
    if (!this.sharedKey) throw new ServiceUnavailableException('Matching is unavailable');
    if (!key || Buffer.byteLength(key) !== Buffer.byteLength(this.sharedKey) ||
        !timingSafeEqual(Buffer.from(key), Buffer.from(this.sharedKey))) {
      throw new NotFoundException();
    }
    return rankLots(parseSnapshot(body));
  }
}

@Module({ controllers: [MatchingController] })
export class MatchingModule {}
