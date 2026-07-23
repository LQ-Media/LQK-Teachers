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
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${baloo.variable} ${nunito.variable} ${amiri.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
