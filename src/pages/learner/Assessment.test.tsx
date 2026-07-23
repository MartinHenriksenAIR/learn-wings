import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// t returns the key with interpolation appended so we can assert current/total.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
  callApiRaw: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getSignedLmsAssetUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/components/ui/sonner', () => ({ toast: vi.fn() }));

vi.mock('@/assets/logo-light.png', () => ({ default: 'logo-light.png' }));
vi.mock('@/assets/logo-light-en.png', () => ({ default: 'logo-light-en.png' }));

// Assessment.tsx reads i18n.language for the logo variant; stub the singleton
// so importing the real i18n bootstrap (initReactI18next) is unnecessary.
vi.mock('@/i18n', () => ({ default: { language: 'da' } }));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

const mockUseAssessmentQuestions = vi.fn();
vi.mock('@/hooks/useAssessmentQuestions', () => ({
  useAssessmentQuestions: () => mockUseAssessmentQuestions(),
}));

const mockUseLearnerCourses = vi.fn();
vi.mock('@/hooks/useLearnerCourses', () => ({
  useLearnerCourses: () => mockUseLearnerCourses(),
}));

import Assessment from './Assessment';

// 7 questions, each with the same 4 option ids for simplicity of the fixture.
const OPTIONS = ['a', 'b', 'c', 'd'];
const QUESTIONS = [
  'usage-frequency',
  'task-breadth',
  'tool-range',
  'iteration-behavior',
  'workflow-integration',
  'self-sufficiency',
  'advanced-features',
].map((id) => ({ id, options: OPTIONS }));

const baseAuth = {
  user: { id: 'u-1' },
  profile: { id: 'p-1' },
  currentOrg: { id: 'org-1', name: 'Org One', slug: 'org-one' },
  refreshUserContext: vi.fn().mockResolvedValue(undefined),
  isLoading: false,
};

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <Assessment />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Select option `a` on every question and press Next, advancing to the end.
function answerAllAndSeeResult() {
  for (let i = 0; i < QUESTIONS.length; i++) {
    fireEvent.click(screen.getAllByRole('radio')[0]);
    const isLast = i === QUESTIONS.length - 1;
    const label = isLast ? 'assessment.seeResult' : 'assessment.next';
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue(baseAuth);
  mockUseAssessmentQuestions.mockReturnValue({
    data: { version: '1', questions: QUESTIONS },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockUseLearnerCourses.mockReturnValue({
    data: { courses: [], enrollments: [] },
    isLoading: false,
  });
});

describe('Assessment wizard', () => {
  it('renders question 1 of 7 with Next disabled until an option is selected', () => {
    renderPage();

    expect(
      screen.getByText('assessment.questionOf:{"current":1,"total":7}'),
    ).toBeInTheDocument();
    expect(screen.getByText('assessment.questions.usage-frequency.text')).toBeInTheDocument();

    const next = screen.getByRole('button', { name: /assessment\.next/ });
    expect(next).toBeDisabled();

    fireEvent.click(screen.getAllByRole('radio')[0]);
    expect(next).toBeEnabled();
  });

  it('disables Back on the first question', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /assessment\.back/ })).toBeDisabled();
  });

  it('preserves earlier answers across forward/back navigation', () => {
    renderPage();

    // Answer q1 with option b, advance.
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[1]); // option 'b'
    expect(radios[1]).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /assessment\.next/ }));

    // Now on q2; Back is enabled.
    const back = screen.getByRole('button', { name: /assessment\.back/ });
    expect(back).toBeEnabled();
    fireEvent.click(back);

    // Back on q1: the previously chosen option is still selected and Next enabled.
    expect(screen.getAllByRole('radio')[1]).toBeChecked();
    expect(screen.getByRole('button', { name: /assessment\.next/ })).toBeEnabled();
  });

  it('keys the animated question block to the question id so it changes between questions', () => {
    const { container } = renderPage();
    const firstBlock = container.querySelector('.slide-in-from-right-4');
    expect(firstBlock).not.toBeNull();

    fireEvent.click(screen.getAllByRole('radio')[0]);
    // Selecting an option must NOT swap the keyed block (same identity/text).
    expect(container.querySelector('.slide-in-from-right-4')).toBe(firstBlock);

    fireEvent.click(screen.getByRole('button', { name: /assessment\.next/ }));
    // Advancing to q2 renders a different question in the keyed block.
    expect(screen.getByText('assessment.questions.task-breadth.text')).toBeInTheDocument();
  });

  it('shows the see-result label on the last question', () => {
    renderPage();
    // Advance through the first 6 questions.
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getAllByRole('radio')[0]);
      fireEvent.click(screen.getByRole('button', { name: /assessment\.next/ }));
    }
    expect(screen.getByRole('button', { name: /assessment\.seeResult/ })).toBeInTheDocument();
  });

  it('submits exactly the 7 selected {questionId: optionId} pairs and switches to the result view', async () => {
    const { callApi } = await import('@/lib/api-client');
    vi.mocked(callApi).mockResolvedValue({ score: 7, level: 'basic' });

    renderPage();
    answerAllAndSeeResult();

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith('/api/assessment-submit', {
        answers: {
          'usage-frequency': 'a',
          'task-breadth': 'a',
          'tool-range': 'a',
          'iteration-behavior': 'a',
          'workflow-integration': 'a',
          'self-sufficiency': 'a',
          'advanced-features': 'a',
        },
      });
    });

    // Result view: persona name + score visible.
    await waitFor(() => {
      expect(screen.getByText('assessment.result.personas.basic')).toBeInTheDocument();
    });
    expect(baseAuth.refreshUserContext).toHaveBeenCalled();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('skip calls the skip endpoint and navigates to the dashboard', async () => {
    const { callApi } = await import('@/lib/api-client');
    vi.mocked(callApi).mockResolvedValue({ skipped_at: '2026-07-01T00:00:00Z' });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /assessment\.skip/ }));

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith('/api/assessment-skip', {});
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/app/dashboard');
    });
  });
});
