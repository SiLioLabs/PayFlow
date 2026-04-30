import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          "stellar-sdk": ["@stellar/stellar-sdk"],
          "react-vendor": ["react", "react-dom"],
        },
      },
    },
  },
});