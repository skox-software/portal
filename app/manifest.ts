import type { MetadataRoute } from "next";
import { BASE_PATH } from "@/lib/paths";

/** Lets the portal be added to a phone's home screen and open like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${BASE_PATH}/`,
    name: "SKOX Client Portal",
    short_name: "SKOX",
    description: "Your SKOX project, in one place.",
    start_url: `${BASE_PATH}/`,
    scope: `${BASE_PATH}/`,
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#faf9f6",
    icons: [
      { src: `${BASE_PATH}/icon.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${BASE_PATH}/icon-maskable.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: `${BASE_PATH}/apple-icon.png`, sizes: "180x180", type: "image/png" },
    ],
  };
}
