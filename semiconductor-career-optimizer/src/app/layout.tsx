import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Semiconductor Career Optimizer", description: "Truth-protected resume tailoring for semiconductor verification engineers" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
