import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Initialize i18n so t() resolves real (English) strings, matching production.
import '@/i18n';

const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

import { CategoryManager } from './CategoryManager';

const categories = [
  { id: 'cat-a', name_en: 'Alpha', name_da: 'Alfa', slug: 'alpha', sort_order: 0, created_at: '2024-01-01T00:00:00Z' },
  { id: 'cat-b', name_en: 'Bravo', name_da: 'Bravo DA', slug: 'bravo', sort_order: 1, created_at: '2024-01-01T00:00:00Z' },
  { id: 'cat-c', name_en: 'Charlie', name_da: 'Charlie DA', slug: 'charlie', sort_order: 2, created_at: '2024-01-01T00:00:00Z' },
];

function renderManager() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CategoryManager />
    </QueryClientProvider>,
  );
}

describe('CategoryManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-categories') return { categories };
      throw new Error(`Unexpected call: ${path}`);
    });
  });

  it('renders each category with both its English and Danish names, in sort order', async () => {
    renderManager();

    await screen.findByText('Alpha');
    expect(screen.getByText('Alfa')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('shows the empty state when there are no categories', async () => {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-categories') return { categories: [] };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderManager();

    expect(await screen.findByText('No categories yet')).toBeInTheDocument();
  });

  it('reorder DOWN on the first row calls the endpoint with the swapped id order', async () => {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-categories') return { categories };
      if (path === '/api/course-category-reorder') return { categories };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderManager();

    await screen.findByText('Alpha');
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]);

    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/course-category-reorder', {
        orderedIds: ['cat-b', 'cat-a', 'cat-c'],
      }),
    );
  });

  it('reorder UP on the last row calls the endpoint with the swapped id order', async () => {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-categories') return { categories };
      if (path === '/api/course-category-reorder') return { categories };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderManager();

    await screen.findByText('Charlie');
    const upButtons = screen.getAllByRole('button', { name: 'Move up' });
    fireEvent.click(upButtons[upButtons.length - 1]);

    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/course-category-reorder', {
        orderedIds: ['cat-a', 'cat-c', 'cat-b'],
      }),
    );
  });

  it('the up arrow on the first row and the down arrow on the last row are disabled', async () => {
    renderManager();

    await screen.findByText('Alpha');
    expect(screen.getAllByRole('button', { name: 'Move up' })[0]).toBeDisabled();
    const downButtons = screen.getAllByRole('button', { name: 'Move down' });
    expect(downButtons[downButtons.length - 1]).toBeDisabled();
  });

  it('add submits both names to the create endpoint', async () => {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-categories') return { categories };
      if (path === '/api/course-category-create') return { category: categories[0] };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderManager();

    await screen.findByText('Alpha');
    fireEvent.change(screen.getByLabelText('English name'), { target: { value: 'Delta' } });
    fireEvent.change(screen.getByLabelText('Danish name'), { target: { value: 'Delta DA' } });
    fireEvent.click(screen.getByRole('button', { name: /add category/i }));

    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/course-category-create', {
        nameEn: 'Delta',
        nameDa: 'Delta DA',
      }),
    );
  });

  it('delete calls the endpoint only after the confirm dialog is accepted', async () => {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-categories') return { categories };
      if (path === '/api/course-category-delete') return { success: true };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderManager();

    await screen.findByText('Bravo');
    // Row delete buttons carry the aria-label "Delete category"; the confirm
    // action inside the dialog is labelled "Delete".
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete category' })[1]);

    const confirm = await screen.findByRole('button', { name: 'Delete' });
    // Not called until the user confirms.
    expect(mockCallApi).not.toHaveBeenCalledWith('/api/course-category-delete', expect.anything());

    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/course-category-delete', { categoryId: 'cat-b' }),
    );
  });
});
