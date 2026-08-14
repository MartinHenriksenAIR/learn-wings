import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQueryOne } = vi.hoisted(() => ({ mockQueryOne: vi.fn() }));
vi.mock('./db', () => ({ queryOne: mockQueryOne }));

import { loadIdea, isIdeaVisibleTo, checkAuthorDraft, type IdeaRow } from './ideas';

const draft = { id: 'idea-1', org_id: 'org-1', user_id: 'author', status: 'draft' };
const submitted = { id: 'idea-1', org_id: 'org-1', user_id: 'author', status: 'submitted' };

const author = { id: 'author' };
const nonAuthor = { id: 'someone-else' };

describe('loadIdea', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues the shared gate-column SELECT and returns the row', async () => {
    const row: IdeaRow = { id: 'idea-1', org_id: 'org-1', user_id: 'author', status: 'draft' };
    mockQueryOne.mockResolvedValueOnce(row);

    const result = await loadIdea('idea-1');

    expect(result).toEqual(row);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe('SELECT id, org_id, user_id, status FROM ideas WHERE id = $1');
    expect(params).toEqual(['idea-1']);
  });

  it('returns null when the idea does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await loadIdea('missing')).toBeNull();
  });
});

describe('isIdeaVisibleTo (draft-privacy truth table)', () => {
  it('draft + author → visible', () => {
    expect(isIdeaVisibleTo(draft, author)).toBe(true);
  });

  it('draft + non-author → hidden', () => {
    expect(isIdeaVisibleTo(draft, nonAuthor)).toBe(false);
  });

  it('draft + non-author who is a platform admin → STILL hidden (no admin bypass)', () => {
    const platformAdmin = { id: 'admin', is_platform_admin: true };
    expect(isIdeaVisibleTo(draft, platformAdmin)).toBe(false);
  });

  it('non-draft + non-author → visible (draft gate does not apply)', () => {
    expect(isIdeaVisibleTo(submitted, nonAuthor)).toBe(true);
  });

  it('non-draft + author → visible', () => {
    expect(isIdeaVisibleTo(submitted, author)).toBe(true);
  });
});

describe('checkAuthorDraft', () => {
  const opts = { notDraftError: 'Only draft ideas can be submitted' };

  it('author + draft → ok', () => {
    expect(checkAuthorDraft(draft, author, opts)).toEqual({ ok: true });
  });

  it('non-author → 403 Forbidden (no admin bypass)', () => {
    expect(checkAuthorDraft(draft, nonAuthor, opts)).toEqual({
      ok: false,
      status: 403,
      body: { error: 'Forbidden' },
    });
  });

  it('author + non-draft → 409 with the caller-supplied notDraftError', () => {
    expect(checkAuthorDraft(submitted, author, opts)).toEqual({
      ok: false,
      status: 409,
      body: { error: 'Only draft ideas can be submitted' },
    });
  });

  it('author + non-draft → 409 carries the endpoint-specific wording', () => {
    expect(checkAuthorDraft(submitted, author, { notDraftError: 'Only draft ideas can be edited' })).toEqual({
      ok: false,
      status: 409,
      body: { error: 'Only draft ideas can be edited' },
    });
  });

  it('author-check runs before the draft-check (non-author on a non-draft → 403)', () => {
    expect(checkAuthorDraft(submitted, nonAuthor, opts)).toEqual({
      ok: false,
      status: 403,
      body: { error: 'Forbidden' },
    });
  });
});
