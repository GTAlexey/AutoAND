import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inlineStaticBuildAssets() {
  return {
    name: 'inline-static-build-assets',
    apply: 'build' as const,
    enforce: 'post' as const,
    generateBundle(_: unknown, bundle: Record<string, any>) {
      const htmlAsset = bundle['index.html'];
      if (!htmlAsset || htmlAsset.type !== 'asset' || typeof htmlAsset.source !== 'string') {
        return;
      }

      let html = htmlAsset.source;

      for (const [fileName, output] of Object.entries(bundle)) {
        const escapedFileName = escapeRegExp(fileName);
        const filePattern = String.raw`(?:\./)?${escapedFileName}`;

        if (output.type === 'chunk' && fileName.endsWith('.js')) {
          const scriptContent = output.code.replace(new RegExp('</script', 'gi'), '<\\/script');
          html = html.replace(
            new RegExp(String.raw`<script[^>]*src=["']${filePattern}["'][^>]*></script>`, 'g'),
            () => `<script type="module">\n${scriptContent}\n</script>`
          );
          delete bundle[fileName];
        }

        if (output.type === 'asset' && fileName.endsWith('.css') && typeof output.source === 'string') {
          const styleContent = output.source.replace(new RegExp('</style', 'gi'), '<\\/style');
          html = html.replace(
            new RegExp(String.raw`<link[^>]*href=["']${filePattern}["'][^>]*>`, 'g'),
            () => `<style>\n${styleContent}\n</style>`
          );
          delete bundle[fileName];
        }
      }

      htmlAsset.source = html;
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), inlineStaticBuildAssets()],
  server: {
    host: '127.0.0.1',
    port: 5173
  }
});
