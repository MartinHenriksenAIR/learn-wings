/**
 * The dashboard's three accents, in the order colour is handed out (course
 * tile 1/2/3, author 1/2/3, podium rank 3/2/1). Mirrors the `dash.a1–a3`
 * Tailwind colours — these hex values exist for the places that need a raw
 * colour rather than a class: SVG paints and the inline fallback style
 * `BrandingAvatar` applies over its own class.
 */
export const DASH_ACCENTS = ['#a5b4fc', '#f7d9a8', '#a7e8c4'] as const;

export const DASH_ACCENT_1 = DASH_ACCENTS[0];
