/**
 * Vitest configuration for the React client.
 *
 * `timezone: "UTC"` is not a detail. These tests are about converting instants
 * into other people's zones, and if they ran in whatever zone the developer's
 * machine happens to be set to, a bug that only appears west of UTC would pass
 * in London and fail in CI — or, worse, the other way round. Pinning the
 * ambient zone means every assertion below is about the zone the code was
 * *told* to use, never the one it inherited.
 *
 * Tests deliberately avoid the DOM: everything covered here is pure date
 * arithmetic in `src/lib`, so there is nothing to render and no need for a
 * jsdom environment.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
    // Every test in this project reasons about timezones explicitly. Running the
    // suite in a fixed one keeps "the zone under test" and "the machine's zone"
    // from ever being confused for each other.
    env: { TZ: "UTC" },
  },
});
