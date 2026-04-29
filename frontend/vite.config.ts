import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // Proxy removed - the React app now handles API URLs directly through the ApiContext
    // This provides full flexibility for localhost/ngrok switching at runtime
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(
    Boolean
  ),
  preview: {
    allowedHosts: ["lerobot-lelab.hf.space"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
