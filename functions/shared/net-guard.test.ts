import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mockLookup }));

import { isBlockedAddress, validatePublicHost, BLOCKED_HOST_MESSAGE } from './net-guard';

describe('isBlockedAddress — IPv4', () => {
  it.each([
    ['0.0.0.0', '0.0.0.0/8'],
    ['10.1.2.3', '10.0.0.0/8'],
    ['127.0.0.1', '127.0.0.0/8'],
    ['169.254.169.254', 'cloud metadata'],
    ['169.254.0.1', '169.254.0.0/16'],
    ['168.63.129.16', 'Azure WireServer host endpoint'],
    ['172.16.0.1', '172.16.0.0/12'],
    ['172.31.255.255', '172.16.0.0/12'],
    ['192.168.1.1', '192.168.0.0/16'],
    ['100.64.0.1', '100.64.0.0/10'],
    ['100.127.255.255', '100.64.0.0/10'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.0.1',   // just below 172.16.0.0/12
    '172.32.0.1',   // just above 172.16.0.0/12
    '100.63.255.255', // just below 100.64.0.0/10
    '100.128.0.1',  // just above 100.64.0.0/10
    '192.169.0.1',
    '169.253.0.1',
    // The WireServer block is a /32 — its neighbours are ordinary public unicast.
    '168.63.129.15',
    '168.63.129.17',
    '168.63.130.16',
    '168.62.129.16',
  ])('allows public %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe('isBlockedAddress — IPv6', () => {
  it.each([
    ['::1', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'expanded loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'fc00::/7 ULA'],
    ['fd12:3456::1', 'fc00::/7 ULA'],
    ['fe80::1', 'fe80::/10 link-local'],
    ['fe80::1%eth0', 'link-local with zone id'],
    ['febf::1', 'fe80::/10 upper bound'],
    ['::ffff:192.168.1.1', 'IPv4-mapped private'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
    ['::ffff:168.63.129.16', 'IPv4-mapped Azure WireServer'],
    ['::FFFF:10.0.0.1', 'IPv4-mapped, uppercase'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
    'fec0::1',            // site-local — outside fe80::/10
    '::ffff:8.8.8.8',     // IPv4-mapped public
  ])('allows public %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe('isBlockedAddress — fails closed', () => {
  it.each(['', 'not-an-ip', '999.1.1.1', '10.0.0', '1:2:3', 'fe80::1::2'])(
    'blocks unparseable %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(true);
    },
  );
});

describe('validatePublicHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the resolved address when every resolved address is public', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    expect(await validatePublicHost('smtp.example.com')).toEqual({ address: '8.8.8.8' });
  });

  // The address travels back so the caller dials it instead of the hostname —
  // without that, the socket resolves again and a rebind wins the race.
  it('pins one vetted address out of a multi-record public answer', async () => {
    mockLookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ]);
    expect(await validatePublicHost('smtp.example.com')).toEqual({ address: '93.184.216.34' });
  });

  it('returns an IP literal host verbatim as the pinned address', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    expect(await validatePublicHost('93.184.216.34')).toEqual({ address: '93.184.216.34' });
  });

  it('rejects when ANY resolved address is private (multi-record answer)', async () => {
    mockLookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    expect(await validatePublicHost('rebind.example.com')).toEqual({ error: BLOCKED_HOST_MESSAGE });
  });

  it('rejects a literal private IP (lookup returns literals verbatim)', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '192.168.1.1', family: 4 }]);
    expect(await validatePublicHost('192.168.1.1')).toEqual({ error: BLOCKED_HOST_MESSAGE });
  });

  it('rejects a host resolving to the Azure WireServer endpoint', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '168.63.129.16', family: 4 }]);
    expect(await validatePublicHost('wireserver.example.com')).toEqual({ error: BLOCKED_HOST_MESSAGE });
  });

  it('rejects an empty host without resolving', async () => {
    expect(await validatePublicHost('   ')).toEqual({ error: 'host is required' });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('reports unresolvable hosts', async () => {
    mockLookup.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND nope.invalid'));
    expect(await validatePublicHost('nope.invalid')).toEqual({ error: 'Could not resolve host nope.invalid' });
  });

  it('reports an empty resolution result', async () => {
    mockLookup.mockResolvedValueOnce([]);
    expect(await validatePublicHost('empty.invalid')).toEqual({ error: 'Could not resolve host empty.invalid' });
  });
});
