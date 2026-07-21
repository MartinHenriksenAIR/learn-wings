import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import en from '@/i18n/locales/en.json';
import da from '@/i18n/locales/da.json';
import i18n from '@/i18n';
import { IDEA_STATUS_OPTIONS } from '@/lib/community-types';
import { IdeaStatusBadge } from './IdeaStatusBadge';

// #208: idea status labels used to render hardcoded English in the Danish UI.
// Every option now carries an i18n `labelKey`; assert parity in both locales and
// that a representative consumer (the badge) renders the translated string.
function resolve(locale: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, locale);
}

describe('idea status label i18n keys (#208)', () => {
  it.each(IDEA_STATUS_OPTIONS.map((o) => o.labelKey))(
    'defines "%s" in both en and da',
    (key) => {
      expect(typeof resolve(en, key)).toBe('string');
      expect((resolve(en, key) as string).length).toBeGreaterThan(0);
      expect(typeof resolve(da, key)).toBe('string');
      expect((resolve(da, key) as string).length).toBeGreaterThan(0);
    },
  );
});

describe('IdeaStatusBadge translated rendering (#208)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  function renderBadge() {
    return render(
      <I18nextProvider i18n={i18n}>
        <IdeaStatusBadge status="submitted" />
      </I18nextProvider>,
    );
  }

  it('renders the Danish label, not the raw English string', async () => {
    await i18n.changeLanguage('da');
    renderBadge();
    // "Indsendt" (da) must appear; the English "Submitted" must not leak through.
    expect(screen.getByText(da.community.ideaStatus.submitted)).toBeInTheDocument();
    expect(en.community.ideaStatus.submitted).not.toBe(da.community.ideaStatus.submitted);
    expect(screen.queryByText(en.community.ideaStatus.submitted)).not.toBeInTheDocument();
  });

  it('renders the English label when the language is English', async () => {
    await i18n.changeLanguage('en');
    renderBadge();
    expect(screen.getByText(en.community.ideaStatus.submitted)).toBeInTheDocument();
  });
});
