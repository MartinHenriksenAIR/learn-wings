import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { da } from 'date-fns/locale';

import i18n from '@/i18n';
import { getDateFnsLocale } from '@/lib/date-locale';
import { CommentItem } from '@/components/community/CommentItem';
import type { CommunityComment } from '@/lib/community-types';

// #209: date-fns timestamps used to render English regardless of UI language.
// The helper now maps the i18next language to a date-fns Locale, and call sites
// pass `i18n.language` so output stays reactive.

describe('getDateFnsLocale (#209)', () => {
  it('maps "da" (and region variants) to the Danish date-fns locale', () => {
    expect(getDateFnsLocale('da')).toBe(da);
    expect(getDateFnsLocale('da-DK')).toBe(da);
    expect(getDateFnsLocale('DA')).toBe(da);
  });

  it('returns undefined for English so date-fns uses its built-in default', () => {
    expect(getDateFnsLocale('en')).toBeUndefined();
    expect(getDateFnsLocale('en-US')).toBeUndefined();
    expect(getDateFnsLocale(undefined)).toBeUndefined();
  });
});

describe('CommentItem relative timestamp localization (#209)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  function makeComment(): CommunityComment {
    // Two hours ago → date-fns "about 2 hours ago" / "cirka 2 timer siden".
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    return {
      id: 'c1',
      content: 'Hello',
      created_at: twoHoursAgo,
      user_id: 'u1',
      is_hidden: false,
      profile: { full_name: 'Ada Lovelace', avatar_url: null },
    } as unknown as CommunityComment;
  }

  function renderComment() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <CommentItem comment={makeComment()} />
        </I18nextProvider>
      </QueryClientProvider>,
    );
  }

  it('renders a Danish relative timestamp when the language is Danish', async () => {
    await i18n.changeLanguage('da');
    renderComment();
    // Danish: "cirka 2 timer siden"; the English "about 2 hours ago" must not leak.
    expect(screen.getByText(/cirka 2 timer siden/)).toBeInTheDocument();
    expect(screen.queryByText(/about 2 hours ago/)).not.toBeInTheDocument();
  });

  it('renders an English relative timestamp when the language is English', async () => {
    await i18n.changeLanguage('en');
    renderComment();
    expect(screen.getByText(/about 2 hours ago/)).toBeInTheDocument();
  });
});
