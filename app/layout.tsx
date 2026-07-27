import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Místopis — příběhy kolem vás",
  description:
    "Osobní AI průvodce historií, příběhy a zajímavostmi místa, kde právě stojíte.",
  applicationName: "Místopis",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#101b1a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
