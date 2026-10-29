
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'three-vendor',
              test: /node_modules\/(three|@react-three\/fiber|@react-three\/drei)\//,
            },
          ],
        },
      },
    },
  },
})
