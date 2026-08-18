/**
 * Keeps the OpenAPI document honest.
 *
 * The document is hand-written, which is the right call — the parts a reviewer
 * most needs are the error cases, and those are not derivable from the route
 * table. The cost is that it can drift, and it had drifted in both directions:
 * two implemented endpoints (`/availability/validate`, `/availability/health`)
 * were missing from it, while three error codes it advertised as things clients
 * should branch on (`ACCOUNT_EXISTS`, `WRONG_AUTH_METHOD`, `SERVICE_IN_USE`)
 * were never emitted by any controller.
 *
 * Both directions of drift are checked here, mechanically, so the next one fails
 * the build instead of reaching a reviewer.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openApiDocument } from "../docs/openapi.js";
import { ERROR_CODES } from "../responseController/responseHandler.js";

const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Every route the app actually serves, as OpenAPI-style paths.
 *
 * Read out of the route files rather than by walking the Express router, because
 * the mount prefix (`/api/bookings`) lives in `server.js` and the path
 * (`/:id/cancel`) lives in the router — and the document is keyed by the two
 * joined together.
 */
function declaredRoutes() {
  const mounts = {
    authRoutes: "/auth",
    providerRoutes: "/providers",
    serviceRoutes: "/services",
    availabilityRoutes: "/availability",
    bookingRoutes: "/bookings",
    reviewRoutes: "/reviews",
  };

  const routes = [];

  for (const [file, mount] of Object.entries(mounts)) {
    const source = fs.readFileSync(path.join(serverDir, "routes", `${file}.js`), "utf8");

    for (const match of source.matchAll(/^router\.(get|post|put|patch|delete)\(\s*"([^"]*)"/gm)) {
      const [, method, routePath] = match;

      // ":id" in Express is "{id}" in OpenAPI; a bare "/" is just the mount.
      const openApiPath = (mount + routePath).replace(/:(\w+)/g, "{$1}").replace(/\/$/, "") || mount;

      routes.push({ method, path: openApiPath });
    }
  }

  return routes;
}

describe("the OpenAPI document covers what the app serves", () => {
  it("documents every route, with the right method", () => {
    const undocumented = declaredRoutes().filter(({ method, path: routePath }) => {
      const entry = openApiDocument.paths[routePath];
      return !entry || !entry[method];
    });

    // Reported as a list so a failure names exactly what to add.
    expect(undocumented.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([]);
  });

  it("does not document routes that no longer exist", () => {
    const served = new Set(declaredRoutes().map((r) => `${r.method} ${r.path}`));

    // Health and readiness are declared in server.js rather than a router.
    const declaredElsewhere = new Set(["get /health", "get /health/db"]);

    const phantom = [];
    for (const [routePath, methods] of Object.entries(openApiDocument.paths)) {
      for (const method of Object.keys(methods)) {
        const key = `${method} ${routePath}`;
        if (!served.has(key) && !declaredElsewhere.has(key)) phantom.push(key);
      }
    }

    expect(phantom).toEqual([]);
  });
});

describe("the documented error codes match the ones the code can emit", () => {
  /** Every code the document tells clients they may see. */
  const documented = new Set(openApiDocument.components.schemas.Error.properties.code.enum);

  /** Every ERROR_CODES member actually referenced by a controller or middleware. */
  function emittedCodes() {
    const sources = ["controller", "middleware", "services", "responseController", "."]
      .flatMap((dir) => {
        const full = path.join(serverDir, dir);
        return fs
          .readdirSync(full, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
          .map((entry) => fs.readFileSync(path.join(full, entry.name), "utf8"));
      })
      .join("\n");

    const emitted = new Set();
    for (const [, code] of sources.matchAll(/ERROR_CODES\.(\w+)/g)) emitted.add(code);
    // bookingRules returns bare code strings rather than importing ERROR_CODES.
    for (const [, code] of sources.matchAll(/code:\s*"([A-Z_]+)"/g)) emitted.add(code);
    return emitted;
  }

  it("advertises no code that nothing can produce", () => {
    // The failure this catches: a client written against the published spec
    // branches on a code the server never sends, and the branch is dead.
    const emitted = emittedCodes();
    const neverEmitted = [...documented].filter((code) => !emitted.has(code));

    expect(neverEmitted).toEqual([]);
  });

  it("documents every code a controller can return", () => {
    const undocumented = [...emittedCodes()].filter(
      (code) => ERROR_CODES[code] !== undefined && !documented.has(code)
    );

    expect(undocumented).toEqual([]);
  });
});
