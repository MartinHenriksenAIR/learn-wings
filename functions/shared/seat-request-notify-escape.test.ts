import { describe, it, expect } from 'vitest';

import { renderSeatRequestEmail } from './seat-request-notify';

// #195 — the platform-admin notification template interpolates user- and
// org-supplied strings into inline HTML. Assert they are HTML-escaped so a
// malicious org/requester name cannot inject markup into the recipient's
// mail client.
const params = {
  recipient: 'admin@ai-uddannelse.dk',
  orgName: '<script>alert("x")</script> & Co "A/S"',
  requesterName: `Mallory <img src=x onerror="alert('1')"> & 'friends'`,
  requesterEmail: 'mallory@evil.example',
  seatLimit: 10,
  usedSeats: 10,
  additionalSeats: 5,
  unitPrice: 1200,
  currency: 'DKK',
  requestId: 'req-1',
  createdAt: '2026-07-20T10:00:00.000Z',
};

describe('renderSeatRequestEmail — HTML escaping (#195)', () => {
  const { html } = renderSeatRequestEmail(params);

  it('escapes < > & and quotes from the org name', () => {
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('escapes < > & and quotes from the requester name', () => {
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&#39;');
  });

  it('renders no raw user-supplied markup in the email body', () => {
    // No angle bracket from the payloads should survive un-escaped. The only
    // raw '<' in the output are the template's own literal tags.
    expect(html).not.toContain('onerror="');
    expect(html).not.toContain('</script>');
  });
});
