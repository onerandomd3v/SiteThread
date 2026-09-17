import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteThread",
  description: "Evidence-backed construction site records",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
