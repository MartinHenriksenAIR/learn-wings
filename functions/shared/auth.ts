import { HttpRequest } from '@azure/functions';

export interface AuthUser {
  id: string;
  email: string;
}

export function authenticate(req: HttpRequest): AuthUser {
  // Stub for testing — replaced by real JWKS validation in Task 9
  const mock = (req as any)._mockUser as AuthUser | undefined;
  if (mock) return mock;
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) throw new Error('Missing or invalid token');
  // In production this will validate the JWT; for now just parse claims naively
  throw new Error('Token validation not yet implemented — awaiting Task 9');
}
