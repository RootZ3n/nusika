import type { Metadata } from "next";
import "./globals.css";
import { ServiceHealthBanner } from "./components/ServiceHealthBanner";

export const metadata: Metadata = {
  title: "Nusika",
  description: "Adaptive learning engine — companion-driven teaching, spaced repetition, mastery spine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ServiceHealthBanner />
        {children}
      </body>
    </html>
  );
}
