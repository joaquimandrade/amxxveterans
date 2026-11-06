import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
  server: { host: true },
});
