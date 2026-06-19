import { test } from "node:test";
import assert from "node:assert/strict";
import { apiUrl } from "../inspector/data.js";

test("resolves api path under a gateway prefix with a filename", () => {
  assert.equal(
    apiUrl("api/snapshot", "/opentree/OpenTree.html"),
    "/opentree/api/snapshot",
  );
});

test("resolves api path at the server root", () => {
  assert.equal(apiUrl("api/snapshot", "/OpenTree.html"), "/api/snapshot");
});

test("resolves api path for a directory root with trailing slash", () => {
  assert.equal(apiUrl("api/refresh", "/opentree/"), "/opentree/api/refresh");
});
