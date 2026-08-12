import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";


export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `strictPort` matters because the API's CORS allow-list names this origin
  // exactly. Vite's default is to move to the next free port if 5173 is taken,
  // which silently produces an origin the API rejects — and the symptom is a
  // failed login, not an obvious port message. Failing to start is clearer.
  server: {
    port: 5173,
    strictPort: true,
  },
})
