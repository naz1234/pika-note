import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pika Note",
    short_name: "Pika Note",
    description: "Public, shared notes and photos. No login needed.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f3e8",
    theme_color: "#f7f3e8",
    orientation: "any",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
