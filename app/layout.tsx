import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f3e8",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;

  return {
    metadataBase: new URL(baseUrl),
    title: "Pika Note — Your notes, wherever you are",
    description: "A public, shared notebook for thoughts and photos. No login needed, with cloud storage across devices.",
    applicationName: "Pika Note",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Pika Note",
    },
    icons: {
      icon: [
        { url: "/favicon-32.png?v=2", type: "image/png", sizes: "32x32" },
        { url: "/icon-192.png?v=2", type: "image/png", sizes: "192x192" },
        { url: "/icon-512.png?v=2", type: "image/png", sizes: "512x512" },
      ],
      apple: [{ url: "/apple-touch-icon.png?v=2", type: "image/png", sizes: "180x180" }],
    },
    openGraph: {
      type: "website",
      title: "Pika Note",
      description: "Your notes. Wherever you are.",
      url: baseUrl,
      siteName: "Pika Note",
      images: [{ url: `${baseUrl}/og.png`, width: 1200, height: 630, alt: "Pika Note — Your notes. Wherever you are." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Pika Note",
      description: "Your notes. Wherever you are.",
      images: [`${baseUrl}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
