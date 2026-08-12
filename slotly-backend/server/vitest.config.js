/**
 * Vitest configuration.
 *
 * `fileParallelism: false` matters: the concurrency suite talks to the real
 * database and manages its own connection pool, and running it alongside another
 * file that also opens the pool produces failures that have nothing to do with
 * the code under test.
 *
 * The pure suites (slotEngine, bookingRules) touch nothing external and would be
 * happy in parallel; serialising them costs a fraction of a second and removes a
 * class of flakiness, which is the better trade for a suite this size.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    fileParallelism: false,
    // The double-booking test deliberately makes connections contend, so it is
    // slower than a normal unit test. This still fails fast on a real hang.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
