import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: 'da' },
  }),
}));

const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));

vi.mock('@/lib/api-client', () => ({ callApi: vi.fn() }));

vi.mock('@/components/ui/select', async () => (await import('@/test/select-mock')).selectMock());

// The assignable-courses hook is exercised in its own layer; here we stub it with
// a mutable state so individual tests can flip loading/error.
const courseAccessState = vi.hoisted(() => ({
  value: {
    data: [{ id: 'c-1', title: 'Course One', language: null }] as unknown[],
    isLoading: false,
    isError: false,
  },
}));
vi.mock('@/hooks/useOrgCourseAccess', () => ({
  useOrgCourseAccess: () => courseAccessState.value,
}));

import { callApi } from '@/lib/api-client';
import { AssignCourseDialog } from './AssignCourseDialog';
import type { OrgMembership, Profile } from '@/lib/types';

const mockCallApi = vi.mocked(callApi);

const members = [
  {
    id: 'm-1', org_id: 'org-1', user_id: 'u-1', role: 'learner', status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    profile: { id: 'u-1', full_name: 'Alice Learner' },
  },
] as unknown as (OrgMembership & { profile: Profile })[];

function renderDialog(props: Partial<React.ComponentProps<typeof AssignCourseDialog>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AssignCourseDialog
        open
        onOpenChange={props.onOpenChange ?? vi.fn()}
        orgId="org-1"
        orgName="Acme"
        members={members}
        presetUserId={props.presetUserId}
        onSuccess={props.onSuccess}
      />
    </QueryClientProvider>,
  );
}

describe('AssignCourseDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallApi.mockResolvedValue({});
    courseAccessState.value = {
      data: [{ id: 'c-1', title: 'Course One', language: null }],
      isLoading: false,
      isError: false,
    };
  });

  it('hides the whole-org option and locks the target when presetUserId is set', () => {
    renderDialog({ presetUserId: 'u-1' });
    expect(screen.queryByText('assignments.target.wholeOrg')).toBeNull();
    // The locked member name is shown instead of a member picker.
    expect(screen.getByText('Alice Learner')).toBeInTheDocument();
  });

  it('assigns to a single member with the chosen course and defaults (mandatory, no due date)', async () => {
    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({ presetUserId: 'u-1', onSuccess, onOpenChange });

    fireEvent.click(screen.getByText('Course One')); // course select (mocked as buttons)
    fireEvent.click(screen.getByRole('button', { name: 'assignments.assign' }));

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/assignment-create', {
        orgId: 'org-1',
        courseId: 'c-1',
        userId: 'u-1',
        mandatory: true,
        dueDate: null,
      });
    });
    expect(onSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('assigns to the whole org (userId null) when the org target is chosen', async () => {
    renderDialog();

    // Switch target to the whole organization.
    fireEvent.click(screen.getByLabelText(/target\.wholeOrg/));
    fireEvent.click(screen.getByText('Course One'));
    fireEvent.click(screen.getByRole('button', { name: 'assignments.assign' }));

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/assignment-create', {
        orgId: 'org-1',
        courseId: 'c-1',
        userId: null,
        mandatory: true,
        dueDate: null,
      });
    });
  });

  it('disables Assign until a course (and member) are chosen', () => {
    renderDialog(); // member target, nothing selected
    expect(screen.getByRole('button', { name: 'assignments.assign' })).toBeDisabled();
  });

  it('shows a load error (not the empty-catalogue message) when the course fetch fails', () => {
    courseAccessState.value = { data: [], isLoading: false, isError: true };
    renderDialog({ presetUserId: 'u-1' });
    expect(screen.getByText('common.loadErrorDescription')).toBeInTheDocument();
    expect(screen.queryByText('assignments.noCourses')).toBeNull();
  });
});
