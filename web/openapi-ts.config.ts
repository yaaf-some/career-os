import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: 'http://127.0.0.1:8787/api/openapi.json',
  output: {
    path: 'src/api/generated',
    format: 'prettier',
  },
  plugins: ['@hey-api/typescript', '@hey-api/client-fetch'],
});
