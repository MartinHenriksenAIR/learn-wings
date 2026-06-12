import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- mock api-client ---
const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

// --- mock sonner toast ---
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Radix Dialog uses a Portal — renders into document.body which is in scope in jsdom.

import { QuizEditorDialog } from './QuizEditorDialog';

const defaultProps = {
  lessonId: 'lesson-1',
  lessonTitle: 'Test Lesson',
  open: true,
  onOpenChange: vi.fn(),
  onQuizSaved: vi.fn(),
};

const emptyQuizResponse = { quiz: null, questions: [] };

/** Returns the passing-score number input. It's a spinbutton by ARIA role. */
function getPassingScoreInput() {
  return screen.getByRole('spinbutton');
}

function renderDialog(props: Partial<typeof defaultProps> = {}) {
  // Fresh QueryClient per render (retry off) so the once-mocks stay
  // deterministic and no quiz cache leaks between renders.
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

    // Retry button should appear after failed load
    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    // No passing-score spinbutton (editable form is not rendered)
    expect(screen.queryByRole('spinbutton')).toBeNull();

    // Save Quiz button must be disabled
    const saveBtn = screen.getByRole('button', { name: /save quiz/i });
    expect(saveBtn).toBeDisabled();
  });

  it('(b) Retry clears the error, refires fetch, and renders the form on success', async () => {
    // First call fails, second succeeds
    mockCallApi
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(emptyQuizResponse);

    renderDialog();

    // Wait for error state
    const retryBtn = await screen.findByRole('button', { name: /retry/i });

    // Click retry
    fireEvent.click(retryBtn);

    // After successful retry, Retry button disappears and form renders
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
    );

    // Passing score spinbutton now visible
    expect(getPassingScoreInput()).toBeInTheDocument();

    // Save Quiz is no longer disabled
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
    // First instance: quiz with score 90 on lesson-a
    mockCallApi.mockResolvedValueOnce({
      quiz: { id: 'quiz-1', lesson_id: 'lesson-a', passing_score: 90 },
      questions: [],
    });

    const { unmount } = renderDialog({ lessonId: 'lesson-a' });

    const input1 = await screen.findByRole('spinbutton');
    expect((input1 as HTMLInputElement).value).toBe('90');

    unmount();

    // Fresh instance (key change remounts): lesson-b has no quiz
    mockCallApi.mockResolvedValueOnce(emptyQuizResponse);

    renderDialog({ lessonId: 'lesson-b' });

    const input2 = await screen.findByRole('spinbutton');
    // Should be reset to default 70, not carried over from lesson-a
    expect((input2 as HTMLInputElement).value).toBe('70');
  });
});
