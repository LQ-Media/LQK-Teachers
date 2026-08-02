import { Noto_Naskh_Arabic } from "next/font/google";

/**
 * One dedicated Arabic face for the whole Wirid & Doa reader.
 *
 * Noto Naskh Arabic is chosen deliberately over the Quran reader's Amiri: it is
 * a plain, highly legible naskh with very broad glyph coverage, and — being
 * self-hosted by Next rather than a system font — it renders identically on
 * every device instead of falling back to each platform's default Arabic face
 * (Geeza Pro on Apple, a different Noto on Android, etc.), which is what made
 * the same passage look different from one phone to the next.
 *
 * Exposed as a CSS variable so the (server) reader page can scope it to its
 * subtree without touching the global font stack in app/layout.js.
 */
export const naskh = Noto_Naskh_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  variable: "--font-dzikir-arabic",
  display: "swap",
});
