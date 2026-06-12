import { describe, it, expect, afterAll, vi, afterEach } from 'vitest';
import { query, queryOne, getDb, isUniqueViolation, buildSslConfig } from './db';
import {
  AZURE_POSTGRES_CA,
  DIGICERT_GLOBAL_ROOT_G2,
  DIGICERT_GLOBAL_ROOT_CA,
  MICROSOFT_RSA_ROOT_CA_2017,
} from './azure-ca';

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
