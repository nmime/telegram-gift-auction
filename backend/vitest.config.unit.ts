import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
import path from "path";
import typia from "@ryoppippi/unplugin-typia/vite";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts", "src/tests/**/*.spec.ts"],
    exclude: [
      "node_modules",
      "dist",
      "dist-test",
      "src/tests/integration/**/*.spec.ts",
    ],
    setupFiles: ["./src/tests/setup-redis-mock.ts"],
    testTimeout: 300000,
    hookTimeout: 300000,
    pool: "forks",
    isolate: true,
    singleFork: true,
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
