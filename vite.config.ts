import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: "worker-provided-editorial-catalog",
    apply: "build",
    enforce: "pre",
    transform(_code, id) {
      // The Worker selects the catalog for each page. A shared browser chunk
      // must not embed the retired editorial records from the signed seed.
      if (id.endsWith("/src/content/published-catalog.json")) return "[]";
    },
  }],
});
