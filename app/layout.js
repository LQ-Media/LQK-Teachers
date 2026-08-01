import { Baloo_2, Nunito_Sans, Amiri } from "next/font/google";
import "./globals.css";

// Display / headings — Baloo 2 (rounded, friendly, on-brand).
const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

// Body / UI — Nunito Sans.
const nunito = Nunito_Sans({
  variable: "--font-nunito",
  subsets: ["latin"],
});

// Amiri — Uthmani-style Arabic for the Quran reader ayah text.
const amiri = Amiri({
  variable: "--font-amiri",
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
});

export const metadata = {
  title: "LQK Teachers Portal",
  description: "Little Quran Kids — Teachers Portal",
  // Home-screen label + iOS standalone behaviour. The apple-touch-icon and
  // manifest <link>s are auto-injected by Next from app/apple-icon.png and
  // app/manifest.js — no need to declare them here.
  appleWebApp: {
    capable: true,
    title: "LQK Teachers",
    statusBarStyle: "default",
  },
};

export const viewport = {
  themeColor: "#333A22",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${baloo.variable} ${nunito.variable} ${amiri.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
