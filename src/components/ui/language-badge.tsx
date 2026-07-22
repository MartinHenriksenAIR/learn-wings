import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export interface LanguageBadgeProps {
  language: "en" | "da" | null;
  className?: string;
}

/**
 * Plain globe icon + muted label for a course's language. Unlike
 * `LevelBadge`, this is deliberately not a colored pill. Renders nothing
 * when the language is null (existing courses predating this field).
 */
export function LanguageBadge({ language, className }: LanguageBadgeProps) {
  const { t } = useTranslation();

  if (language === null) {
    return null;
  }

  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] text-muted-foreground", className)}>
      <Globe aria-hidden="true" className="h-3.5 w-3.5" />
      {t(`languages.${language}`)}
    </span>
  );
}
