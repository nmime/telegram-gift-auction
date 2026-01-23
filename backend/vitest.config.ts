import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
import path from "path";
// @ts-expect-error - Package exports require bundler moduleResolution
import typia from "@ryoppippi/unplugin-typia/vite";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts", "src/tests/**/*.spec.ts"],
    exclude: ["node_modules", "dist", "dist-test"],
    setupFiles: ["./src/tests/setup-redis-mock.ts"],
    testTimeout: 300000,
    hookTimeout: 300000,
    pool: "forks",
    isolate: true,
    singleFork: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/**/*.e2e.ts", "src/tests/**/*.ts"],
      reporter: ["text", "json", "html"],
    },
    alias: {
      "@/": path.resolve(__dirname, "./src/"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "./src/"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    typia(),
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: {
          syntax: "typescript",
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        keepClassNames: true,
      },
    }),
  ],
});
