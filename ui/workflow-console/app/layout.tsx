import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Foresight Workflow Console",
  description: "Transparent CrewAI workflow control and review UI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
