import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));

// Separate entry/config: the production app never uses these fixture hooks.
export default defineConfig({
  plugins: [react()],
  cacheDir: path.join(os.tmpdir(), "nori-recording-check-vite"),
  optimizeDeps: { entries: ["recording-check.html"] },
  build: { rollupOptions: { input: path.resolve(root, "recording-check.html") } },
  server: { host: "127.0.0.1", port: 5181, strictPort: true },
  resolve: { alias: [
    { find: "@/nori/TeleopSessionContext", replacement: path.resolve(root, "src/nori/dev/recordingCheckHooks.ts") },
    { find: "@/contexts/ApiContext", replacement: path.resolve(root, "src/nori/dev/recordingCheckHooks.ts") },
    { find: "@nori/sdk/mock", replacement: path.resolve(root, "packages/nori-sdk/src/entry-mock.ts") },
    { find: "@nori/sdk", replacement: path.resolve(root, "packages/nori-sdk/src/index.ts") },
    { find: "@", replacement: path.resolve(root, "src") },
  ] },
});
