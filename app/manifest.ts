import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Místopis — příběhy kolem vás",
    short_name: "Místopis",
    description: "Osobní AI průvodce místem, kde právě jste.",
    start_url: "/",
    display: "standalone",
    background_color: "#101b1a",
    theme_color: "#101b1a",
    icons: [],
  };
}
