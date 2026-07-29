import React from 'react';

/**
 * Shared test double for the Radix Select primitives (`@/components/ui/select`).
 *
 * jsdom can't drive the real Radix Select portal, so tests replace it with this
 * lightweight stand-in. Each `SelectItem` renders as a button that calls the
 * parent's `onValueChange` with its value, so a test can pick an option by
 * clicking its label; `SelectContent` is a passthrough div and `SelectValue`
 * renders its placeholder. `SelectTrigger` renders a real `<button>` (the
 * labelable combobox the real Radix trigger is) and forwards its props —
 * notably `id`, so a `<Label htmlFor>` associates with it and `getByLabelText`
 * resolves the trigger (#327). This was copy-pasted into four test files —
 * hoisted here so there is one copy.
 *
 * Usage (the factory must be re-imported inside the hoisted vi.mock factory):
 *
 *   vi.mock('@/components/ui/select', async () => (await import('@/test/select-mock')).selectMock());
 */
export function selectMock() {
  const h = React.createElement;
  const Ctx = React.createContext<((v: string) => void) | undefined>(undefined);
  const pass = ({ children }: { children?: React.ReactNode }) => h('div', null, children);
  return {
    Select: ({
      children,
      onValueChange,
    }: {
      children?: React.ReactNode;
      onValueChange?: (v: string) => void;
    }) => h(Ctx.Provider, { value: onValueChange }, h('div', null, children)),
    SelectTrigger: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
      h('button', { type: 'button', ...props }, children),
    SelectValue: ({ placeholder }: { placeholder?: string }) => h('span', null, placeholder),
    SelectContent: pass,
    SelectItem: ({ children, value }: { children?: React.ReactNode; value: string }) => {
      const onValueChange = React.useContext(Ctx);
      return h('button', { type: 'button', onClick: () => onValueChange?.(value) }, children);
    },
  };
}
