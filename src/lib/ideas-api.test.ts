import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the api client so no MSAL/network fires
const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
  callApiRaw: vi.fn(),
}));

import { createIdea, updateIdea, updateIdeaPriority } from './ideas-api';
import type { BusinessArea } from '@/lib/community-types';

describe('ideas-api payload coercions (old client-lib parity)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallApi.mockResolvedValue({ idea: { id: 'idea-1' } });
  });

  it('createIdea coerces empty-string optional fields to null (the form defaults every field to "")', async () => {
    // IdeaSubmit's form initializes business_area (a PG enum server-side) and all
    // text fields as '' — the old lib mapped them with `|| null` before insert.
    await createIdea({
      org_id: 'org-1',
      title: 'My draft',
      business_area: '' as BusinessArea, // unselected <Select> → ''
      tags: undefined,
      current_process: '',
      pain_points: '',
    });

    const [path, body] = mockCallApi.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/idea-create');
    expect(body.business_area).toBeNull(); // '' would 400 the enum validation server-side
    expect(body.current_process).toBeNull();
    expect(body.pain_points).toBeNull();
    expect(body.tags).toEqual([]);
  });

  it('createIdea passes real values through untouched', async () => {
    await createIdea({
      org_id: 'org-1',
      title: 'My draft',
      business_area: 'hr',
      tags: ['ai'],
      pain_points: 'slow',
    });

    const [, body] = mockCallApi.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.business_area).toBe('hr');
    expect(body.tags).toEqual(['ai']);
    expect(body.pain_points).toBe('slow');
  });

  it('updateIdea coerces empty-string business_area to null, leaves other keys verbatim', async () => {
    await updateIdea('idea-1', {
      title: 'Renamed',
      business_area: '' as BusinessArea,
      pain_points: '',
    });

    const [path, body] = mockCallApi.mock.calls[0] as [string, { updates: Record<string, unknown> }];
    expect(path).toBe('/api/idea-update');
    expect(body.updates.business_area).toBeNull(); // '' would 400 the enum validation server-side
    expect(body.updates.title).toBe('Renamed');
    expect(body.updates.pain_points).toBe(''); // text fields stay verbatim on update (old behavior)
  });

  it('updateIdea does not add business_area when the key is absent', async () => {
    await updateIdea('idea-1', { title: 'Renamed' });

    const [, body] = mockCallApi.mock.calls[0] as [string, { updates: Record<string, unknown> }];
    expect('business_area' in body.updates).toBe(false);
  });

  it('updateIdeaPriority calls the right endpoint with the right payload', async () => {
    const result = await updateIdeaPriority('idea-1', 3, 1);

    const [path, body] = mockCallApi.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/idea-prioritize');
    expect(body).toEqual({ ideaId: 'idea-1', value: 3, effort: 1 });
    expect(result).toEqual({ id: 'idea-1' });
  });
});
