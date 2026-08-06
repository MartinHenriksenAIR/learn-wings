import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'da' } }),
}));

const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));

vi.mock('@/lib/api-client', () => ({ callApi: vi.fn() }));

const hookState = vi.hoisted(() => ({
  value: { data: [] as unknown[], isLoading: false, isError: false, refetch: () => {} },
}));
vi.mock('@/hooks/useOrgAssignments', () => ({
  useOrgAssignments: () => hookState.value,
}));

import { callApi } from '@/lib/api-client';
import { AssignmentsManager } from './AssignmentsManager';
import type { OrgAssignment } from '@/lib/types';

const mockCallApi = vi.mocked(callApi);

const rows: OrgAssignment[] = [
  {
    id: 'a1', orgId: 'org-1', courseId: 'c1', courseTitle: 'AI Basics',
    userId: 'u1', userFullName: 'Alice Learner', mandatory: true, dueDate: '2026-09-01',
    assignedByUserId: 'p1', assignedByName: 'Admin', createdAt: '2026-08-05T12:00:00Z',
  },
  {
    id: 'a2', orgId: 'org-1', courseId: 'c2', courseTitle: 'AI Ethics',
    userId: null, userFullName: null, mandatory: false, dueDate: null,
    assignedByUserId: 'p1', assignedByName: 'Admin', createdAt: '2026-08-04T12:00:00Z',
  },
];

function renderManager() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AssignmentsManager orgId="org-1" />
    </QueryClientProvider>,
  );
}

describe('AssignmentsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.value = { data: rows, isLoading: false, isError: false, refetch: () => {} };
    mockCallApi.mockResolvedValue({ deleted: true });
  });

  it('renders individual and whole-org assignments', () => {
    renderManager();
    expect(screen.getByText('AI Basics')).toBeInTheDocument();
    expect(screen.getByText('AI Ethics')).toBeInTheDocument();
    expect(screen.getByText('Alice Learner')).toBeInTheDocument();
    // The whole-org (null-user) row shows the wholeOrg label.
    expect(screen.getByText('assignments.wholeOrg')).toBeInTheDocument();
  });

  it('confirms and removes an assignment via assignment-delete', async () => {
    renderManager();
    // First row's Remove opens the confirm dialog.
    fireEvent.click(screen.getAllByRole('button', { name: 'assignments.remove' })[0]);
    expect(screen.getByText('assignments.removeConfirmTitle')).toBeInTheDocument();
    // Confirm inside the dialog.
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'assignments.remove' }));

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/assignment-delete', { assignmentId: 'a1' });
    });
  });

  it('shows the empty state when there are no assignments', () => {
    hookState.value = { data: [], isLoading: false, isError: false, refetch: () => {} };
    renderManager();
    expect(screen.getByText('assignments.empty')).toBeInTheDocument();
  });

  it('shows an error state on load failure', () => {
    hookState.value = { data: [], isLoading: false, isError: true, refetch: () => {} };
    renderManager();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
