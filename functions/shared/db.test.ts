import { describe, it, expect, afterAll, beforeEach, vi, afterEach } from 'vitest';
import { Client, PoolConfig } from 'pg';
import { query, queryOne, getDb, isUniqueViolation, buildSslConfig, buildPoolConfig } from './db';
import {
  AZURE_POSTGRES_CA,
  DIGICERT_GLOBAL_ROOT_G2,
  DIGICERT_GLOBAL_ROOT_CA,
  MICROSOFT_RSA_ROOT_CA_2017,
} from './azure-ca';

/**
 * The ssl pg would ACTUALLY use for a given Pool/Client config — the value a
 * real connection is configured with, after pg's own resolution. pg computes it
 * in ConnectionParameters at Client construction (no socket opens until
 * .connect()); crucially, if the config still carries a `connectionString`, pg
 * re-derives ssl from it and overlays the explicit `ssl` option — which is the
 * exact clobber issue #103 fixes. Asserting on this resolved value (rather than
 * the raw config object) is what catches that regression; a bare buildSslConfig()
 * unit test cannot.
 *
 * Read `connectionParameters.ssl`, not the public `client.ssl`: the latter is
 * `connectionParameters.ssl || {}`, which silently turns a resolved `false`
 * (sslmode=disable) into `{}` and would hide that case. @types/pg doesn't expose
 * `.connectionParameters`, so reach it through a narrow local shape.
 */
function effectiveSsl(config: PoolConfig): false | { ca?: string; rejectUnauthorized?: boolean } {
  const client = new Client(config);
  return (
    client as unknown as {
      connectionParameters: { ssl: false | { ca?: string; rejectUnauthorized?: boolean } };
    }
  ).connectionParameters.ssl;
}

const skip = !process.env.DATABASE_URL;

// Pure unit tests — no DATABASE_URL gate.
describe('buildSslConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to verify-full: rejectUnauthorized true with the Azure CA bundle', () => {
    const config = buildSslConfig({});
    expect(config.rejectUnauthorized).toBe(true);
    expect(config.ca).toBe(AZURE_POSTGRES_CA);
  });

  it('the CA bundle contains exactly 3 PEM certificates', () => {
    const begins = AZURE_POSTGRES_CA.match(/-----BEGIN CERTIFICATE-----/g) ?? [];
    const ends = AZURE_POSTGRES_CA.match(/-----END CERTIFICATE-----/g) ?? [];
    expect(begins).toHaveLength(3);
    expect(ends).toHaveLength(3);
    expect(AZURE_POSTGRES_CA).toContain(DIGICERT_GLOBAL_ROOT_G2.trim());
    expect(AZURE_POSTGRES_CA).toContain(DIGICERT_GLOBAL_ROOT_CA.trim());
    expect(AZURE_POSTGRES_CA).toContain(MICROSOFT_RSA_ROOT_CA_2017.trim());
  });

  it('each bundled cert parses as a valid X509 certificate', async () => {
    const { X509Certificate } = await import('node:crypto');
    const subjects = [DIGICERT_GLOBAL_ROOT_G2, DIGICERT_GLOBAL_ROOT_CA, MICROSOFT_RSA_ROOT_CA_2017].map(
      (pem) => new X509Certificate(pem).subject
    );
    expect(subjects.join('\n')).toContain('DigiCert Global Root G2');
    expect(subjects.join('\n')).toContain('DigiCert Global Root CA');
    expect(subjects.join('\n')).toContain('Microsoft RSA Root Certificate Authority 2017');
  });

  it('DATABASE_SSL_INSECURE=1 falls back to unverified TLS and warns loudly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = buildSslConfig({ DATABASE_SSL_INSECURE: '1' });
    expect(config).toEqual({ rejectUnauthorized: false });
    expect(config.ca).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('DATABASE_SSL_INSECURE');
  });

  it('other DATABASE_SSL_INSECURE values do not trigger the escape hatch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(buildSslConfig({ DATABASE_SSL_INSECURE: '0' }).rejectUnauthorized).toBe(true);
    expect(buildSslConfig({ DATABASE_SSL_INSECURE: 'true' }).rejectUnauthorized).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});

// Pure unit tests — no DATABASE_URL gate. Asserts the URL's sslmode can't
// clobber our pinned-CA ssl, exercised through pg's real config resolution.
describe('buildPoolConfig', () => {
  const PROD_SHAPED_URL =
    'postgres://app:secret@db.example.postgres.database.azure.com:5432/learnwings?sslmode=require';

  beforeEach(() => {
    // pg-connection-string emits a process warning when it sees sslmode=require
    // (a v3 deprecation notice, irrelevant here — our explicit ssl object governs
    // verification, not sslmode). Silence it to keep test output pristine.
    vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the pinned Azure CA when DATABASE_URL has ?sslmode=require (verify-full not clobbered)', () => {
    const ssl = effectiveSsl(buildPoolConfig(PROD_SHAPED_URL));
    expect(ssl).not.toBe(false);
    expect((ssl as { ca?: string }).ca).toBe(AZURE_POSTGRES_CA);
    expect((ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized).toBe(true);
  });

  it('does not carry a connectionString key (the clobber vector)', () => {
    expect('connectionString' in buildPoolConfig(PROD_SHAPED_URL)).toBe(false);
  });

  it('parses host, database, user and port from the URL', () => {
    const config = buildPoolConfig(PROD_SHAPED_URL);
    expect(config.host).toBe('db.example.postgres.database.azure.com');
    expect(config.database).toBe('learnwings');
    expect(config.user).toBe('app');
    expect(config.port).toBe(5432);
  });

  it('keeps the DATABASE_SSL_INSECURE rollback hatch functional through the URL path', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ssl = effectiveSsl(buildPoolConfig(PROD_SHAPED_URL, { DATABASE_SSL_INSECURE: '1' }));
    expect(ssl).toEqual({ rejectUnauthorized: false });
  });

  it('keeps the pinned Azure CA when DATABASE_URL has no sslmode', () => {
    const noSslmodeUrl = 'postgres://app:secret@db.example.postgres.database.azure.com:5432/learnwings';
    const ssl = effectiveSsl(buildPoolConfig(noSslmodeUrl));
    expect((ssl as { ca?: string }).ca).toBe(AZURE_POSTGRES_CA);
    expect((ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized).toBe(true);
  });
});

// getDb() is the only production caller of buildPoolConfig; pin the wiring so a
// revert to `new Pool({ connectionString, ssl })` (the original #103 bug) fails
// here instead of slipping past the buildPoolConfig-only tests above.
describe('getDb wiring', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  it('builds its Pool through buildPoolConfig so the pinned CA reaches the live pool', async () => {
    vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    vi.resetModules(); // fresh module → fresh pool singleton, isolated from other tests
    process.env.DATABASE_URL =
      'postgres://app:secret@db.example.postgres.database.azure.com:5432/learnwings?sslmode=require';
    const fresh = await import('./db');
    const pool = fresh.getDb();
    try {
      const options = (pool as unknown as { options: PoolConfig }).options;
      expect('connectionString' in options).toBe(false);
      expect((effectiveSsl(options) as { ca?: string }).ca).toBe(AZURE_POSTGRES_CA);
    } finally {
      await pool.end(); // pool never connected; end() resolves immediately
    }
  });
});

// Pure unit tests — no DATABASE_URL gate.
describe('isUniqueViolation', () => {
  it('returns true for a Postgres unique_violation (code 23505)', () => {
    expect(isUniqueViolation(Object.assign(new Error('duplicate key value'), { code: '23505' }))).toBe(true);
  });

  it('returns false for other Postgres error codes', () => {
    expect(isUniqueViolation(Object.assign(new Error('fk violation'), { code: '23503' }))).toBe(false);
  });

  it('returns false for plain errors without a code', () => {
    expect(isUniqueViolation(new Error('connection refused'))).toBe(false);
  });

  it('returns false for null/undefined/non-object values', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});

describe.skipIf(skip)('db integration', () => {
  afterAll(async () => {
    await getDb().end();
  });

  it('query returns rows', async () => {
    const rows = await query<{ ok: number }>('SELECT 1 AS ok');
    expect(rows[0]).toEqual({ ok: 1 });
  });

  it('queryOne returns single row', async () => {
    const row = await queryOne<{ ok: number }>('SELECT 1 AS ok');
    expect(row).toEqual({ ok: 1 });
  });

  it('queryOne returns null when no results', async () => {
    const row = await queryOne('SELECT 1 WHERE false');
    expect(row).toBeNull();
  });
});
