import { queryOne } from './db';


export interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
}

export async function loadIdea(ideaId: string): Promise<IdeaRow | null> {
  return queryOne<IdeaRow>(
    `SELECT id, org_id, user_id, status FROM ideas WHERE id = $1`,
    [ideaId],
  );
}

export function isIdeaVisibleTo(
  idea: Pick<IdeaRow, 'status' | 'user_id'>,
  profile: { id: string },
): boolean {
  return !(idea.status === 'draft' && idea.user_id !== profile.id);
}

export interface AuthorDraftError {
  ok: false;
  status: 403 | 409;
  body: { error: string };
}

export type AuthorDraftResult = { ok: true } | AuthorDraftError;

export function checkAuthorDraft(
  idea: Pick<IdeaRow, 'status' | 'user_id'>,
  profile: { id: string },
  opts: { notDraftError: string },
): AuthorDraftResult {
  if (idea.user_id !== profile.id) {
    return { ok: false, status: 403, body: { error: 'Forbidden' } };
  }
  if (idea.status !== 'draft') {
    return { ok: false, status: 409, body: { error: opts.notDraftError } };
  }
  return { ok: true };
}
