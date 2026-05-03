import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magister",
  description: "Adaptive learning engine — companion-driven teaching, spaced repetition, mastery spine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
