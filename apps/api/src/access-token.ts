import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

@Injectable()
export class AccessTokenVerifier {
  private readonly issuer = process.env.AUTH0_ISSUER?.trim();
  private readonly audience = process.env.AUTH0_AUDIENCE?.trim();
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

  constructor() {
    if (!this.issuer && !this.audience) {
      return;
    }

    if (!this.issuer || !this.audience) {
      throw new Error('Configure both AUTH0_ISSUER and AUTH0_AUDIENCE');
    }

    const issuerUrl = new URL(this.issuer);
    if (issuerUrl.protocol !== 'https:' || this.issuer !== `${issuerUrl.origin}/`) {
      throw new Error('AUTH0_ISSUER must be an HTTPS origin with a trailing slash');
    }

    this.jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', issuerUrl));
  }

  async verifyAuthorization(authorization: string | undefined): Promise<void> {
    const token = /^Bearer +([^\s,]+)$/i.exec(authorization ?? '')?.[1];
    if (!token) {
      throw new UnauthorizedException('A bearer access token is required');
    }

    if (!this.jwks) {
      throw new ServiceUnavailableException('Token validation is unavailable');
    }

    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub'],
    }).catch((error: unknown) => {
      if (
        error instanceof errors.JWTExpired ||
        error instanceof errors.JWTClaimValidationFailed ||
        error instanceof errors.JWTInvalid ||
        error instanceof errors.JWSInvalid ||
        error instanceof errors.JOSEAlgNotAllowed ||
        error instanceof errors.JWKSNoMatchingKey ||
        error instanceof errors.JWSSignatureVerificationFailed
      ) {
        throw new UnauthorizedException('Invalid access token');
      }
      throw new ServiceUnavailableException('Token validation is unavailable');
    });

    if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
