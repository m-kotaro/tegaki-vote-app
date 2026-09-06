import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the tegaki-vote-app frontend.
// - React plugin for JSX/Fast Refresh.
// - `VITE_API_BASE_URL` selects the backend API base at build/dev time.
// - `VITE_ENABLE_MOCKS` toggles the MSW mock worker (defaults to on in dev).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
