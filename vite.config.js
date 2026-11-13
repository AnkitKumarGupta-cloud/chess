import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// The home page (lessons, puzzles, quiz) is a ready-made file in public/.
// Vite only builds the live classroom page, class.html.
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { class: "class.html" } }, chunkSizeWarningLimit: 6000 },
});
