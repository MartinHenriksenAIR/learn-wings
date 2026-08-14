import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));


import { QuizEditorDialog } from './QuizEditorDialog';

const defaultProps = {
  lessonId: 'lesson-1',
  lessonTitle: 'Test Lesson',
  open: true,
  onOpenChange: vi.fn(),
  onQuizSaved: vi.fn(),
};

const emptyQuizResponse = { quiz: null, questions: [] };

function getPassingScoreInput() {
  return screen.getByRole('spinbutton');
}

function renderDialog(props: Partial<typeof defaultProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuizEditorDialog {...defaultProps} {...props} />
    </QueryClientProvider>
  );
}

describe('QuizEditorDialog — load-error guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) failed load renders Retry button and no editable form; Save is disabled', async () => {
    mockCallApi.mockRejectedValueOnce(new Error('Network error'));

    renderDialog();

    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    expect(screen.queryByRole('spinbutton')).toBeNull();

    const saveBtn = screen.getByRole('button', { name: /save quiz/i });
    expect(saveBtn).toBeDisabled();
  });

  it('(b) Retry clears the error, refires fetch, and renders the form on success', async () => {
    mockCallApi
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(emptyQuizResponse);

    renderDialog();

    const retryBtn = await screen.findByRole('button', { name: /retry/i });

    fireEvent.click(retryBtn);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
    );

    expect(getPassingScoreInput()).toBeInTheDocument();

    const saveBtn = screen.getByRole('button', { name: /save quiz/i });
    expect(saveBtn).not.toBeDisabled();
  });
});

describe('QuizEditorDialog — passingScore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(c) onChange clamps typed value 150 → 100', async () => {
    mockCallApi.mockResolvedValueOnce(emptyQuizResponse);

    renderDialog();

    const input = await screen.findByRole('spinbutton');
    fireEvent.change(input, { target: { value: '150' } });

    expect((input as HTMLInputElement).value).toBe('100');
  });

  it('(c) onChange clamps negative value → 0', async () => {
    mockCallApi.mockResolvedValueOnce(emptyQuizResponse);

    renderDialog();

    const input = await screen.findByRole('spinbutton');
    fireEvent.change(input, { target: { value: '-5' } });

    expect((input as HTMLInputElement).value).toBe('0');
  });

  it('(c) onChange treats empty string (NaN) as 0', async () => {
    mockCallApi.mockResolvedValueOnce(emptyQuizResponse);

    renderDialog();

    const input = await screen.findByRole('spinbutton');
    fireEvent.change(input, { target: { value: '' } });

    expect((input as HTMLInputElement).value).toBe('0');
  });

  it('(d) no-quiz load resets passingScore to default 70 (fresh instance)', async () => {
    mockCallApi.mockResolvedValueOnce({
      quiz: { id: 'quiz-1', lesson_id: 'lesson-a', passing_score: 90 },
      questions: [],
    });

    const { unmount } = renderDialog({ lessonId: 'lesson-a' });

    await waitFor(() => expect((getPassingScoreInput() as HTMLInputElement).value).toBe('90'));

    unmount();

    mockCallApi.mockResolvedValueOnce(emptyQuizResponse);

    renderDialog({ lessonId: 'lesson-b' });

    const input2 = await screen.findByRole('spinbutton');
    expect((input2 as HTMLInputElement).value).toBe('70');
  });
});

describe('QuizEditorDialog — label associations (#327)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('associates the passing-score label with its input', async () => {
    mockCallApi.mockResolvedValueOnce(emptyQuizResponse);

    renderDialog();

    const input = await screen.findByLabelText('quizEditor.passingScoreLabel');
    expect(input).toHaveAttribute('id', 'quiz-passing-score');
    expect(input).toBe(screen.getByRole('spinbutton'));
  });
});
