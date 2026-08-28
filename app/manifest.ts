import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pika Note",
    short_name: "Pika Note",
    description: "Public, shared notes and photos. No login needed.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff5fb",
    theme_color: "#fff5fb",
    orientation: "any",
    icons: [
      // Keep the complete artwork visible rather than allowing a launcher to crop it.
      { src: "/icon-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
