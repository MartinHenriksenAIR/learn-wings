import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import { EventCard } from './EventCard';
import type { CommunityPost } from '@/lib/community-types';

// t returns the key, but interpolates `name` so the host line carries the real
// author name (language is 'en' so the real formatDate stays English).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => (opts?.name ? `${key}:${opts.name}` : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// A local-time date (no trailing Z) keeps the rendered month/day timezone-stable.
const event = {
  id: 'e1',
  scope: 'global',
  org_id: null,
  user_id: 'author-1',
  category_id: 'cat-events',
  title: 'Prompt Engineering Workshop',
  content: 'Bring your questions.',
  tags: [],
  is_pinned: false,
  is_hidden: false,
  is_locked: false,
  event_date: '2999-06-15T18:30:00',
  event_location: 'Room 200, HQ',
  event_registration_url: 'https://example.com/register',
  event_recording_url: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  profile: { id: 'author-1', full_name: 'Ada Lovelace' } as CommunityPost['profile'],
} as CommunityPost;

// Probe that surfaces the detail route's params, so a card click can be asserted
// to have navigated to the right post — routed by the event's own scope.
function DetailProbe() {
  const { scope, postId } = useParams();
  return <div>detail:{scope}:{postId}</div>;
}

function renderCard(e: CommunityPost = event) {
  return render(
    <MemoryRouter initialEntries={['/events']}>
      <Routes>
        <Route path="/events" element={<EventCard event={e} />} />
        <Route path="/app/community/:scope/posts/:postId" element={<DetailProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EventCard (#125)', () => {
  it('renders the month/day date block from event_date', () => {
    renderCard();
    expect(screen.getByText('Jun')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('renders the host name and the location', () => {
    renderCard();
    expect(screen.getByText('community.hostedBy:Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Room 200, HQ')).toBeInTheDocument();
  });

  it('sources the Join href from event_registration_url and opens a new tab', () => {
    renderCard();
    const link = screen.getByRole('link', { name: /community\.join/ });
    expect(link).toHaveAttribute('href', 'https://example.com/register');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('drops a javascript: registration URL so the Join anchor has no href (stored-XSS guard, #232)', () => {
    const { container } = renderCard({
      ...event,
      event_registration_url: 'javascript:alert(document.cookie)',
    } as CommunityPost);
    // An <a> with no href isn't exposed with the "link" role, so query the DOM
    // directly: the Join anchor still renders but carries no (dangerous) href.
    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor).not.toHaveAttribute('href');
    // getByRole('link') finds nothing precisely because the href was stripped.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('navigates to the post detail via post.scope when the card body is clicked', () => {
    renderCard();
    fireEvent.click(screen.getByText('Prompt Engineering Workshop'));
    expect(screen.getByText('detail:global:e1')).toBeInTheDocument();
  });

  it('does not navigate to the detail when the Join button is clicked', () => {
    renderCard();
    fireEvent.click(screen.getByRole('link', { name: 'community.join' }));
    expect(screen.queryByText(/^detail:/)).not.toBeInTheDocument();
    // Still on the events route — the card is present.
    expect(screen.getByText('Prompt Engineering Workshop')).toBeInTheDocument();
  });
});
