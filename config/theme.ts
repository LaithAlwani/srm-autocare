// Midnight Precision design tokens — JS mirror of the CSS custom properties in
// app/globals.css. Use these when you need a token in JS (Framer Motion variants,
// inline canvas/SVG colors, chart libs that can't read CSS variables).
//
// IMPORTANT: keep in sync with the @theme block in app/globals.css. If you change
// a color, change it in BOTH places (or the JSX-driven animations will drift
// from the CSS-driven ones).

export const colors = {
  // Surfaces (tonal layering — darker → lighter)
  surface: "#131313",
  surfaceContainerLowest: "#0e0e0e",
  surfaceContainerLow: "#1c1b1b",
  surfaceContainer: "#201f1f",
  surfaceContainerHigh: "#2a2a2a",
  surfaceContainerHighest: "#353534",
  surfaceBright: "#393939",

  // Brand
  primary: "#007aff",
  primaryHover: "#3393ff",
  primaryMuted: "#adc6ff",
  primaryContainer: "#4b8eff",
  onPrimary: "#ffffff",
  onPrimaryContainer: "#00285c",

  // Text
  foreground: "#e5e2e1",
  foregroundMuted: "#c1c6d7",
  chrome: "#e5e5e5",

  // Lines / outlines
  outline: "#8b90a0",
  outlineVariant: "#414755",
  border: "rgba(229, 229, 229, 0.1)",
  borderHover: "rgba(173, 198, 255, 0.4)",

  // Semantic
  success: "#34d399",
  error: "#ffb4ab",
  errorContainer: "#93000a",
  onError: "#690005",
} as const;

export const typography = {
  fontDisplay: "var(--font-hanken)",
  fontBody: "var(--font-inter)",
  fontMono: "var(--font-jetbrains)",

  display: { size: "48px", weight: 800, leading: "1.1", tracking: "-0.02em" },
  headlineLg: { size: "32px", weight: 700, leading: "1.2", tracking: "-0.01em" },
  headlineMd: { size: "20px", weight: 600, leading: "1.4", tracking: "0" },
  bodyLg: { size: "18px", weight: 400, leading: "1.6", tracking: "0" },
  bodyMd: { size: "16px", weight: 400, leading: "1.6", tracking: "0" },
  labelTech: { size: "12px", weight: 500, leading: "1.0", tracking: "0.1em" },
} as const;

export const spacing = {
  base: 8,
  gutter: 24,
  marginMobile: 16,
  sectionGapDesktop: 80,
  sectionGapMobile: 48,
  containerMax: 1280,
} as const;

export const effects = {
  glowPrimary: "0 0 15px rgba(0, 122, 255, 0.3)",
  glowPrimarySoft: "0 0 15px rgba(0, 122, 255, 0.15)",
  textGlow: "0 0 10px rgba(173, 198, 255, 0.5)",
  glossGradient:
    "linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0) 100%)",
} as const;

export const radius = {
  // Sharp by design — every surface is 0px corners.
  none: "0px",
  // Pills only (e.g. status chips that need full roundness)
  full: "9999px",
} as const;

export const theme = { colors, typography, spacing, effects, radius } as const;
export type Theme = typeof theme;
