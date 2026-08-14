import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

const AVATAR_COLORS = ["#10298f", "#1e9e6a", "#b07514", "#8a4fb8", "#c43d3d", "#0f7e8a"];

export function getAvatarColor(name?: string | null): string {
  if (!name) return AVATAR_COLORS[0];
  return AVATAR_COLORS[(name.length * 7 + name.charCodeAt(0)) % AVATAR_COLORS.length];
}
