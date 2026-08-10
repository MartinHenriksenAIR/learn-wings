import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Sidebar, SidebarProvider, useSidebar } from './sidebar';

function StateProbe() {
  const { state } = useSidebar();
  return <span data-testid="state">{state}</span>;
}

function renderProvider(props: { defaultOpen?: boolean; open?: boolean } = {}) {
  return render(
    <SidebarProvider {...props}>
      <StateProbe />
    </SidebarProvider>,
  );
}

// Every page mounts its own AppLayout, so the provider remounts on each navigation.
// Persistence (#370) therefore hinges on the provider re-reading the cookie on mount —
// not just writing it on toggle.
describe('SidebarProvider cookie persistence (#370)', () => {
  beforeEach(() => {
    // The provider writes the cookie with path=/; clear it the same way between tests.
    document.cookie = 'sidebar:state=; path=/; max-age=0';
  });

  it('starts collapsed when the persisted cookie is false, overriding default-open', () => {
    document.cookie = 'sidebar:state=false; path=/';
    renderProvider(); // defaultOpen defaults to true
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed');
  });

  it('starts expanded when the persisted cookie is true, overriding default-closed', () => {
    document.cookie = 'sidebar:state=true; path=/';
    renderProvider({ defaultOpen: false });
    expect(screen.getByTestId('state')).toHaveTextContent('expanded');
  });

  it('falls back to defaultOpen when no cookie is set', () => {
    renderProvider({ defaultOpen: false });
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed');
  });

  it('lets a controlled `open` prop win over the cookie', () => {
    document.cookie = 'sidebar:state=false; path=/';
    renderProvider({ open: true });
    expect(screen.getByTestId('state')).toHaveTextContent('expanded');
  });
});

// The panel width animates over 200ms while the content swaps to its target layout
// in a single frame — so mid-animation the (wider) expanded content is briefly painted
// into the still-narrow rail and spills out ("warped/oversized" flash, #396). The fix is
// overflow-hidden on the panel, masking the overflow into a clean reveal. jsdom applies no
// layout, so this pins the class as a regression guard (e.g. against a shadcn re-sync
// silently dropping it) rather than asserting the visual behaviour.
describe('Sidebar panel clips overflow during the width animation (#396)', () => {
  it('keeps overflow-hidden on the panel box', () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <div>content</div>
        </Sidebar>
      </SidebarProvider>,
    );
    const panel = container.querySelector('[data-sidebar="sidebar"]');
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass('overflow-hidden');
  });
});
