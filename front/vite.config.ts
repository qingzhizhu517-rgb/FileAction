import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { env } from "node:process";
import { fileURLToPath } from "node:url";
import { introPage } from "./introPlugin.js";

export default defineConfig({
  plugins: [
    react(),
    introPage(fileURLToPath(new URL("../frontend/", import.meta.url))),
  ],
  server: {
    host: "127.0.0.1",
    port: 8785,
    proxy: {
      "/api/v1": env.FILEACTION_DEV_API_TARGET || "http://127.0.0.1:8000",
      "/api": "http://127.0.0.1:8766",
    },
  },
  build: {
    outDir: "dist",
    rolldownOptions: { input: { main: "index.html", legacy: "legacy.html", personal: "personal.html" } },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/testSetup.ts"],
    include: ["src/**/*.test.*"],
    css: true,
  },
});
