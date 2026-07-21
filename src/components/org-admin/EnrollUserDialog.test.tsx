import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// --- mock react-i18next (no i18n provider needed); interpolation params are
// --- appended so assertions can check the summary counts ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts
        ? `${key}:${Object.entries(opts)
            .map(([k, v]) => `${k}=${v}`)
            .join(',')}`
        : key,
  }),
}));

// --- mock sonner toast ---
const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// --- mock api-client with a local ApiError (importing the real module pulls in MSAL) ---
vi.mock('@/lib/api-client', () => {
  class MockApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }
  return { callApi: vi.fn(), ApiError: MockApiError };
});

// --- replace the Radix Select with a clickable list (jsdom can't drive Radix Select) ---
vi.mock('@/components/ui/select', async () => (await import('@/test/select-mock')).selectMock());

// --- ScrollArea uses ResizeObserver; a plain div is enough here ---
vi.mock('@/components/ui/scroll-area', async () => {
  const ReactActual = await import('react');
  return {
    ScrollArea: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement('div', null, children),
  };
});

import { callApi, ApiError } from '@/lib/api-client';
import { EnrollUserDialog } from './EnrollUserDialog';
import type { OrgMembership, Profile } from '@/lib/types';

const mockCallApi = vi.mocked(callApi);

const members = [
  {
    id: 'm-1',
    org_id: 'org-1',
    user_id: 'u-1',
    role: 'learner',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    profile: { id: 'u-1', full_name: 'Alice Learner' },
  },
] as unknown as (OrgMembership & { profile: Profile })[];

const courseAccess = {
  access: [
    {
      id: 'a-1',
      course_id: 'c-1',
      access: 'enabled',
      course: { id: 'c-1', title: 'Course One', level: 'basic', is_published: true },
    },
    {
      id: 'a-2',
      course_id: 'c-2',
      access: 'enabled',
      course: { id: 'c-2', title: 'Course Two', level: 'basic', is_published: true },
    },
  ],
};

describe('EnrollUserDialog — per-row failure reasons (#62)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallApi.mockImplementation(async (path: string, body: unknown) => {
      if (path === '/api/org-course-access') return courseAccess;
      if (path === '/api/enrollments') return { enrollments: [] };
      if (path === '/api/enrollment-create') {
        const { courseId } = body as { courseId: string };
        if (courseId === 'c-1') {
          throw new ApiError('No course access for this organization', 403);
        }
        return { enrollment: { id: 'e-1' } };
      }
      throw new Error(`Unexpected callApi path: ${path}`);
    });
  });

  it('renders the real per-row reason on a 403 and the summary reflects 1 enrolled / 1 failed', async () => {
    const onSuccess = vi.fn();
    render(
      <EnrollUserDialog
        open
        onOpenChange={vi.fn()}
        orgId="org-1"
        orgName="Acme"
        members={members}
        onSuccess={onSuccess}
      />
    );

    // Pick the team member (mocked Select renders members as buttons)
    fireEvent.click(screen.getByText('Alice Learner'));

    // Courses load; select both
    fireEvent.click(await screen.findByText('Course One'));
    fireEvent.click(screen.getByText('Course Two'));

    fireEvent.click(screen.getByRole('button', { name: /Enroll in 2 Courses/i }));

    // The 403's real message is rendered per row — not a generic fallback
    expect(await screen.findByText(/No course access for this organization/)).toBeInTheDocument();
    expect(screen.getByText('enrollDialog.failuresTitle')).toBeInTheDocument();
    expect(screen.queryByText(/may already be enrolled/i)).toBeNull();

    // Summary toast reflects the mixed outcome: 1 enrolled, 1 failed
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'enrollDialog.partialTitle',
        description: 'enrollDialog.partialDescription:success=1,failed=1',
        variant: 'destructive',
      })
    );

    // Both rows were attempted, parent refresh fired despite the failure
    const createCalls = mockCallApi.mock.calls.filter(([p]) => p === '/api/enrollment-create');
    expect(createCalls).toHaveLength(2);
    expect(onSuccess).toHaveBeenCalled();
  });
});
