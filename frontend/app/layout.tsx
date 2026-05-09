import type { Metadata } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: "Arkemis NEO Dashboard",
  description: "NASA NeoWs dashboard powered by FastAPI and Next.js",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
