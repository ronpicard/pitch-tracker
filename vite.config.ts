import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths work on both username.github.io and /repository/ Pages sites.
  base: './',
  test: { include: ['src/**/*.test.ts'] },
})
