import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // relative base so the built app works at github.io/<repo>/ project pages
  base: './',
  plugins: [react()],
  server: { port: 5176 }, // 5174 = pitch-and-yaw-finder, 5173/5175 = tours
})
