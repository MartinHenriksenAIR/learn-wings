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

/**
 * Deterministic avatar circle color from a display name (port of the design
 * prototype's `avatar()` hash). Same name always gets the same color, so
 * avatars stay stable across feed, comments, and widgets.
 */
const AVATAR_COLORS = ["#10298f", "#1e9e6a", "#b07514", "#8a4fb8", "#c43d3d", "#0f7e8a"];

export function getAvatarColor(name?: string | null): string {
  if (!name) return AVATAR_COLORS[0];
  return AVATAR_COLORS[(name.length * 7 + name.charCodeAt(0)) % AVATAR_COLORS.length];
}
