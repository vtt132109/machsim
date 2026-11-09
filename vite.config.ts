import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        // React and ReactDOM change far less often than the app: one cacheable vendor chunk.
        // The core part catalogue (src/library/catalog) gets its own chunk; it loads at start-up
        // with the library, so getPart() stays synchronous for the parts samples and lessons use.
        // The big catalogue packs (diode / transistor part numbers, logic families, series by
        // package, connectors, RF: src/library/catalog/index.ts CATALOGUE_PACKS) are dynamic
        // imports, one chunk per pack, loaded the first time their group is opened.
        // Feature code (instrument panels, Grapher, analysis dialog, help, breadboard 3D,
        // examples) is split by its dynamic imports; see src/ui/common/lazy.tsx.
        codeSplitting: {
          groups: [
            // (react-dom/server stays with the image export that uses it)
            { name: 'react', test: /[\\/]node_modules[\\/](react[\\/]|scheduler[\\/]|react-dom[\\/](index|client)\.js|react-dom[\\/]cjs[\\/]react-dom(-client)?\.production\.js)/ },
            // lazy catalogue packs (one chunk each)
            { name: 'catalogue-logic', test: /[\\/]src[\\/]library[\\/]catalog[\\/](logicCatalog|logic74|logic4000)\.ts/ },
            { name: 'catalogue-diodes', test: /[\\/]src[\\/]library[\\/]catalog[\\/](diodes|thyristors)\.ts/ },
            { name: 'catalogue-transistors', test: /[\\/]src[\\/]library[\\/]catalog[\\/](bjts|fets)\.ts/ },
            { name: 'catalogue-series', test: /[\\/]src[\\/]library[\\/]catalog[\\/]passiveSeries\.ts/ },
            { name: 'catalogue-connectors', test: /[\\/]src[\\/]library[\\/]catalog[\\/]connectors\.ts/ },
            { name: 'catalogue-rf', test: /[\\/]src[\\/]library[\\/]catalog[\\/]rf\.ts/ },
            // the start-up digital catalogue (logic kit, memories, converters, displays)
            { name: 'catalogue-digital', test: /[\\/]src[\\/]library[\\/]catalog[\\/](logicKit|digitalMisc|mixedSignal|displayParts)/ },
            { name: 'catalogue', test: /[\\/]src[\\/]library[\\/]catalog[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 60000,
  },
});
