import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n';
import en from '@/i18n/locales/en.json';
import { InviteLanguageSelect } from './InviteLanguageSelect';

vi.mock('@/components/ui/select', async () => (await import('@/test/select-mock')).selectMock());

function renderSelect(props: Partial<React.ComponentProps<typeof InviteLanguageSelect>> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <InviteLanguageSelect value="da" onChange={() => {}} {...props} />
    </I18nextProvider>,
  );
}

describe('InviteLanguageSelect', () => {
  it('renders the emailLanguage label and both reused language option labels', async () => {
    await i18n.changeLanguage('en');
    renderSelect();

    expect(screen.getByText(en.common.emailLanguage)).toBeInTheDocument();
    expect(screen.getByText(en.languages.da)).toBeInTheDocument();
    expect(screen.getByText(en.languages.en)).toBeInTheDocument();
  });

  it('calls onChange with the picked InviteLanguage when an option is selected', async () => {
    await i18n.changeLanguage('en');
    const onChange = vi.fn();
    renderSelect({ value: 'da', onChange });

    fireEvent.click(screen.getByText(en.languages.en));
    expect(onChange).toHaveBeenCalledWith('en');
  });
});
