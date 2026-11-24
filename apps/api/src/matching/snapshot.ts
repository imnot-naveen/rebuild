export const matchRadiusMetres = 25_000;
export const matchCandidateLimit = 100;

export interface MatchCandidate {
  lotId: string;
  distanceMetres: number;
  availableQuantity: number;
}

export interface MatchSnapshot {
  allocatableQuantity: number;
  candidates: MatchCandidate[];
}

export interface RankedCandidate {
  lotId: string;
  coveredQuantity: number;
  explanation: string;
}

export interface Ranking {
  policyVersion: string;
  candidates: RankedCandidate[];
}
