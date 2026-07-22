import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // If you use GitHub Pages, uncomment the line below and change 'mlb-fan-app' to match your GitHub repository name:
  // base: '/mlb-fan-app/',
});
