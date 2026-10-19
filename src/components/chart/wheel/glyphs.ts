import type { Body, Sign } from "@/lib/astrology/types";

/**
 * U+FE0E asks for the plain text form of a symbol. Without it, browsers draw
 * the zodiac signs as colour emoji.
 */
const TEXT_STYLE = "\uFE0E";

export const SIGN_GLYPHS: Record<Sign, string> = {
  aries: `\u2648${TEXT_STYLE}`,
  taurus: `\u2649${TEXT_STYLE}`,
  gemini: `\u264A${TEXT_STYLE}`,
  cancer: `\u264B${TEXT_STYLE}`,
  leo: `\u264C${TEXT_STYLE}`,
  virgo: `\u264D${TEXT_STYLE}`,
  libra: `\u264E${TEXT_STYLE}`,
  scorpio: `\u264F${TEXT_STYLE}`,
  sagittarius: `\u2650${TEXT_STYLE}`,
  capricorn: `\u2651${TEXT_STYLE}`,
  aquarius: `\u2652${TEXT_STYLE}`,
  pisces: `\u2653${TEXT_STYLE}`,
};

export const BODY_GLYPHS: Record<Body, string> = {
  sun: `\u2609${TEXT_STYLE}`,
  moon: `\u263D${TEXT_STYLE}`,
  mercury: `\u263F${TEXT_STYLE}`,
  venus: `\u2640${TEXT_STYLE}`,
  mars: `\u2642${TEXT_STYLE}`,
  jupiter: `\u2643${TEXT_STYLE}`,
  saturn: `\u2644${TEXT_STYLE}`,
  uranus: `\u2645${TEXT_STYLE}`,
  neptune: `\u2646${TEXT_STYLE}`,
  pluto: `\u2647${TEXT_STYLE}`,
};

/**
 * Crescent for the Moon, centred on 0,0 and about 20 units tall. The font
 * glyph for the Moon is already an outline, so it cannot show the difference
 * between a known Moon (filled) and an uncertain one (outline only).
 */
export const MOON_PATH =
  "M-6.5 -9.5A10 10 0 1 1 -6.5 9.5A11.5 11.5 0 0 0 -6.5 -9.5Z";

/** Fonts that carry the astrological symbols as plain outlines. */
export const GLYPH_FONT_FAMILY =
  '"Segoe UI Symbol", "Noto Sans Symbols", "Noto Sans Symbols 2", "Apple Symbols", system-ui, sans-serif';

export type Element = "fire" | "earth" | "air" | "water";

export const SIGN_ELEMENTS: Record<Sign, Element> = {
  aries: "fire",
  taurus: "earth",
  gemini: "air",
  cancer: "water",
  leo: "fire",
  virgo: "earth",
  libra: "air",
  scorpio: "water",
  sagittarius: "fire",
  capricorn: "earth",
  aquarius: "air",
  pisces: "water",
};
