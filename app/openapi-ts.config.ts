import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../api/openapi.yml",
  output: "app/lib/api",
});
