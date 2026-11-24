import type { MatchSnapshot, Ranking } from './snapshot';

export function rankLots({ allocatableQuantity, candidates }: MatchSnapshot): Ranking {
  const covered = candidates.map((candidate) => ({
    ...candidate,
    coveredQuantity: Math.min(candidate.availableQuantity, allocatableQuantity),
  }));
  covered.sort((left, right) => {
    const distanceOrder = left.distanceMetres - right.distanceMetres;
    if (distanceOrder !== 0) return distanceOrder;
    const coverageOrder = right.coveredQuantity - left.coveredQuantity;
    if (coverageOrder !== 0) return coverageOrder;
    if (left.lotId === right.lotId) return 0;
    return left.lotId < right.lotId ? -1 : 1;
  });

  return {
    policyVersion: 'distance-first-v1',
    candidates: covered.map(({ lotId, coveredQuantity }) => ({
      lotId,
      coveredQuantity,
      explanation: `Covers ${coveredQuantity} of ${allocatableQuantity} needed. Ranked by distance, then coverage.`,
    })),
  };
}
