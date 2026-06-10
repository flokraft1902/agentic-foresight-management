import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Foresight Review Console",
  description: "Human-in-the-loop UI for reviewing AI-based foresight decisions",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
