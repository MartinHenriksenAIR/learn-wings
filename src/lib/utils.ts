import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Avatar initials from a full name: first letter of each word, max two
 * ("Martin Vladinov" → "MV"). Single canonical implementation — some sites
 * previously used `name.slice(0, 2)` ("MA"), which disagreed with this one.
 */
export function getInitials(name?: string | null, fallback = "U"): string {
  return (
    name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || fallback
  );
}
