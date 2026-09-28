import { defineConfig } from "astro/config";
import { SITE } from "./site.config";

export default defineConfig({
  site: SITE.url,
  trailingSlash: "always",
});
