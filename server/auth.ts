import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthSession, UserRole } from './types.ts';
import { logger } from './logger.ts';

const ROLE_WEIGHT: Record<UserRole, number> = {
  guest: 0,
  researcher: 1,
  auditor: 2,
  principal_investigator: 3,
};

export interface RoleDirectoryUser {
  userId: string;
  name: string;
  email: string;
  organization?: string;
  role: UserRole;
  accessCode: string;
}

export const DIRECTORY_USERS: RoleDirectoryUser[] = [
  {
    userId: 'usr-researcher-01',
    name: 'Dr. Maya Ben-Ami',
    email: 'maya.benami@intel-lab.org',
    organization: 'INTEL Research Lab',
    role: 'researcher',
    accessCode: 'RESEARCH-2026',
  },
  {
    userId: 'usr-pi-01',
    name: 'Prof. David Cohen',
    email: 'd.cohen@intel-lab.org',
    organization: 'INTEL Research Lab',
    role: 'principal_investigator',
    accessCode: 'PI-LAB-2026',
  },
  {
    userId: 'usr-auditor-01',
    name: 'Elena Levy',
    email: 'elena.levy@intel-lab.org',
    organization: 'INTEL Governance Office',
    role: 'auditor',
    accessCode: 'AUDIT-2026',
  },
];

const REGISTERED_USERS: RoleDirectoryUser[] = [];

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export function signSessionToken(session: AuthSession): string {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string | undefined): AuthSession | null {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AuthSession;
    if (!parsed.expiresAt || Date.parse(parsed.expiresAt) < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function registerAccount(input: {
  name: string;
  email: string;
  organization?: string;
  role: 'researcher' | 'principal_investigator';
  accessCode: string;
}): { ok: true; session: AuthSession; user: RoleDirectoryUser } | { ok: false; status: 409; error: string } {
  const normalizedEmail = input.email.trim().toLowerCase();
  const exists = [...DIRECTORY_USERS, ...REGISTERED_USERS].some(
    (u) => u.email.toLowerCase() === normalizedEmail
  );
  if (exists) {
    return {
      ok: false,
      status: 409,
      error: `An account with email '${normalizedEmail}' is already registered.`,
    };
  }

  const user: RoleDirectoryUser = {
    userId: `usr-${crypto.randomUUID().slice(0, 8)}`,
    name: input.name.trim(),
    email: normalizedEmail,
    organization: input.organization?.trim() || 'Partner Laboratory',
    role: input.role,
    accessCode: input.accessCode.trim(),
  };
  REGISTERED_USERS.push(user);

  const now = Date.now();
  const session: AuthSession = {
    userId: user.userId,
    name: user.name,
    email: user.email,
    organization: user.organization,
    role: user.role,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };

  logger.info('auth', 'Registered new researcher/partner account', {
    userId: user.userId,
    role: user.role,
    organization: user.organization,
  });

  return { ok: true, session, user };
}

export function authenticateCredentials(
  roleOrEmail: string,
  accessCode?: string
): AuthSession | null {
  const normalized = roleOrEmail.trim().toLowerCase();
  const dirMatch = DIRECTORY_USERS.find(
    (u) => u.role === normalized || u.email.toLowerCase() === normalized
  );
  const regMatch = !dirMatch
    ? REGISTERED_USERS.find((u) => u.email.toLowerCase() === normalized)
    : undefined;
  const matched = dirMatch ?? regMatch;
  if (!matched) return null;

  if (regMatch) {
    if (!accessCode || accessCode !== regMatch.accessCode) {
      return null;
    }
  } else if (accessCode !== undefined && accessCode !== matched.accessCode) {
    return null;
  }

  const now = Date.now();
  return {
    userId: matched.userId,
    name: matched.name,
    email: matched.email,
    organization: matched.organization,
    role: matched.role,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
}

export function hasRoleAtLeast(userRole: UserRole, required: UserRole): boolean {
  if (required === 'auditor') {
    return userRole === 'auditor' || userRole === 'principal_investigator';
  }
  return ROLE_WEIGHT[userRole] >= ROLE_WEIGHT[required];
}

export interface AuthenticatedRequest extends Request {
  sessionUser: AuthSession;
}

export function attachSession(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : undefined;

  const session = verifySessionToken(bearerToken);
  (req as AuthenticatedRequest).sessionUser = session ?? {
    userId: 'usr-guest',
    name: 'Guest Observer',
    email: 'guest@intel-lab.org',
    role: 'guest',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
  next();
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const session = (req as AuthenticatedRequest).sessionUser;
    if (!session || session.role === 'guest') {
      logger.warn('auth', 'Unauthenticated access blocked', {
        path: req.path,
        method: req.method,
      });
      res.status(401).json({
        error: 'Authentication required for this operation.',
        requiredRoles: allowedRoles,
      });
      return;
    }

    if (!allowedRoles.includes(session.role)) {
      logger.warn('auth', 'Role authorization denied', {
        userId: session.userId,
        role: session.role,
        requiredRoles: allowedRoles,
        path: req.path,
      });
      res.status(403).json({
        error: `Role '${session.role}' lacks permission for this action.`,
        requiredRoles: allowedRoles,
      });
      return;
    }

    next();
  };
}
