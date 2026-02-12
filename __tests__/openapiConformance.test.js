/**
 * OpenAPI ↔ Express route conformance tests.
 *
 * Ensures every Express route is documented in the OpenAPI spec and
 * vice versa.  Catches undocumented routes (drift) and phantom docs
 * (spec entries with no matching route).
 */
const spec = require("../src/openapi");
const apiRouter = require("../src/routes/apiRoutes");

// ── Routes intentionally excluded from the OpenAPI spec ─────────────
// Internal utilities that are not part of the public API contract.
const EXCLUDED_ROUTES = new Set(["GET /api/test", "GET /api/version"]);

// ── Helpers ─────────────────────────────────────────────────────────

/** Convert Express `:param` syntax to OpenAPI `{param}`. */
function expressToOpenAPIPath(path) {
  return path.replace(/:([^/]+)/g, "{$1}");
}

/** Strip trailing slash (except bare `/`). */
function stripTrailing(path) {
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

/**
 * Extract the mount-path prefix from a router.use() layer.
 * Supports Express 4 (layer.regexp) and Express 5 (layer.matchers).
 */
function getMountPath(layer) {
  // ── Express 4: regexp-based matching ──────────────────────────────
  if (layer.regexp) {
    if (layer.regexp.fast_slash) return "";
    const src = layer.regexp.source || "";
    const segments = [];
    const re = /\\\/([a-zA-Z0-9_\-.]+)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      segments.push(m[1]);
    }
    return segments.length > 0 ? "/" + segments.join("/") : "";
  }

  // ── Express 5: matcher-function-based matching ────────────────────
  if (layer.matchers && layer.matchers[0]) {
    const matcher = layer.matchers[0];

    // Root mount (router.use(handler) without a path) matches '/'
    if (matcher("/")) return "";

    // Probe common mount-path segments to discover the prefix
    const PROBES = [
      "admin",
      "api",
      "auth",
      "changes",
      "companies",
      "config",
      "dashboard",
      "docs",
      "export",
      "health",
      "insights",
      "jobs",
      "locations",
      "metrics",
      "notifications",
      "people",
      "query",
      "search",
      "seniority",
      "settings",
      "signals",
      "status",
      "test",
      "users",
      "version",
      "webhook",
      "workers",
    ];

    for (const word of PROBES) {
      const result = matcher("/" + word);
      if (result) return result.path;
    }
  }

  return "";
}

/**
 * Recursively walk an Express router's layer stack and collect
 * every registered route as `"METHOD /path"`.
 */
function extractExpressRoutes(router, prefix = "") {
  const routes = new Set();
  if (!router || !router.stack) return routes;

  for (const layer of router.stack) {
    if (layer.route) {
      // Direct route (router.get / .post / .delete / …)
      const raw = stripTrailing(prefix + layer.route.path);
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled && !method.startsWith("_")) {
          routes.add(`${method.toUpperCase()} ${raw}`);
        }
      }
    } else if (layer.handle && layer.handle.stack) {
      // Sub-router (router.use(path, subRouter))
      const mount = getMountPath(layer);
      for (const r of extractExpressRoutes(layer.handle, prefix + mount)) {
        routes.add(r);
      }
    }
  }

  return routes;
}

/** Extract documented routes from the OpenAPI spec. */
function extractSpecRoutes(openApiSpec) {
  const routes = new Set();
  const methods = ["get", "post", "put", "delete", "patch"];

  for (const [path, pathItem] of Object.entries(openApiSpec.paths)) {
    for (const method of methods) {
      if (pathItem[method]) {
        routes.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }

  return routes;
}

// ── Build route sets ────────────────────────────────────────────────

const specRoutes = extractSpecRoutes(spec);

// Routes from apiRoutes (mounted at /api)
const rawExpress = extractExpressRoutes(apiRouter, "/api");

// Routes defined directly in index.js (outside apiRoutes)
rawExpress.add("GET /health");

// Normalise Express paths → OpenAPI notation
const expressRoutes = new Set();
for (const route of rawExpress) {
  const spaceIdx = route.indexOf(" ");
  const method = route.slice(0, spaceIdx);
  const path = route.slice(spaceIdx + 1);
  expressRoutes.add(`${method} ${expressToOpenAPIPath(path)}`);
}

// ── Tests ───────────────────────────────────────────────────────────

describe("OpenAPI ↔ Express conformance", () => {
  test("every OpenAPI route is registered in Express (no phantom docs)", () => {
    const phantom = [...specRoutes].filter((r) => !expressRoutes.has(r));

    if (phantom.length > 0) {
      throw new Error(
        `${phantom.length} OpenAPI route(s) not registered in Express:\n` +
          phantom.map((r) => `  - ${r}`).join("\n"),
      );
    }
  });

  test("every Express route is documented in OpenAPI (minus exclusions)", () => {
    const undocumented = [...expressRoutes].filter(
      (r) => !specRoutes.has(r) && !EXCLUDED_ROUTES.has(r),
    );

    if (undocumented.length > 0) {
      throw new Error(
        `${undocumented.length} Express route(s) missing from OpenAPI spec:\n` +
          undocumented.map((r) => `  - ${r}`).join("\n") +
          "\n\nAdd to spec or EXCLUDED_ROUTES.",
      );
    }
  });

  test("no stale entries in exclusion list", () => {
    const stale = [...EXCLUDED_ROUTES].filter((r) => !expressRoutes.has(r));

    if (stale.length > 0) {
      throw new Error(
        `${stale.length} exclusion(s) no longer match any Express route:\n` +
          stale.map((r) => `  - ${r}`).join("\n") +
          "\n\nRemove stale entries from EXCLUDED_ROUTES.",
      );
    }
  });
});
