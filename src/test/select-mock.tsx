import React from 'react';

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
