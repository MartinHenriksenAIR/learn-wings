import * as React from "react";
import { Check, Save } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SaveButtonProps {
  done: boolean;
  idleLabel: React.ReactNode;
  doneLabel?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit" | "reset";
}

/**
 * Primary save button with in-button success feedback (port of the design
 * prototype's `saveBtn`): navy + Save icon when idle; success green + Check
 * icon + done label while `done` is true. The done-state timing is owned by
 * callers (pair with `useFlash`).
 */
export function SaveButton({ done, idleLabel, doneLabel, onClick, disabled, className, type = "button" }: SaveButtonProps) {
  const { t } = useTranslation();

  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(done && "bg-success text-success-foreground hover:bg-success/90", className)}
    >
      {done ? <Check aria-hidden="true" /> : <Save aria-hidden="true" />}
      {done ? (doneLabel ?? t("common.saved")) : idleLabel}
    </Button>
  );
}
