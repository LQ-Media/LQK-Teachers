import { Lora, Inter, Amiri } from "next/font/google";
import "./globals.css";

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
    <html lang="en" className={`${lora.variable} ${inter.variable} ${amiri.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
