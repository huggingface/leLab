import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  cacheDir: path.join(os.tmpdir(), "nori-recording-live-check-vite"),
  optimizeDeps: { entries: ["recording-live-check.html"] },
  build: { rollupOptions: { input: path.resolve(root, "recording-live-check.html") } },
  server: { host: "127.0.0.1", port: 5184, strictPort: true, proxy: {
    "/issue51-robot": { target: "http://127.0.0.1:5182", rewrite: (url) => url.replace(/^\/issue51-robot/, "") },
    "/nori": { target: "http://127.0.0.1:5183" },
  } },
  resolve: { alias: [
    { find: "@/nori/TeleopSessionContext", replacement: path.resolve(root, "src/nori/dev/recordingLiveCheckHooks.ts") },
    { find: "@/contexts/ApiContext", replacement: path.resolve(root, "src/nori/dev/recordingLiveCheckHooks.ts") },
    { find: "@nori/sdk/mock", replacement: path.resolve(root, "packages/nori-sdk/src/entry-mock.ts") },
    { find: "@nori/sdk", replacement: path.resolve(root, "packages/nori-sdk/src/index.ts") },
    { find: "@", replacement: path.resolve(root, "src") },
  ] },
});
