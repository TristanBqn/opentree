import { test } from "node:test";
import assert from "node:assert/strict";
import { registerOpenTree } from "../dist/register.js";

function mockApi() {
  const routes = [];
  const services = [];
  return {
    routes,
    services,
    registerHttpRoute: (p) => routes.push(p),
    registerService: (s) => services.push(s),
    logger: { info() {}, error() {} },
  };
}

test("registers one plugin-auth prefix route at /opentree", () => {
  const api = mockApi();
  registerOpenTree(api, {
    staticDir: ".",
    hosts: [{ root: "/tmp", name: "~/openclaw" }],
    stateDir: "/tmp/state",
    socketPath: "/var/run/docker.sock",
  });
  assert.equal(api.routes.length, 1);
  assert.equal(api.routes[0].path, "/opentree");
  assert.equal(api.routes[0].auth, "plugin");
  assert.equal(api.routes[0].match, "prefix");
  assert.equal(typeof api.routes[0].handler, "function");
});

test("registers a watcher service with start and stop", () => {
  const api = mockApi();
  registerOpenTree(api, {
    staticDir: ".",
    hosts: [{ root: "/tmp", name: "~/openclaw" }],
    stateDir: "/tmp/state",
    socketPath: "/var/run/docker.sock",
  });
  assert.equal(api.services.length, 1);
  assert.equal(api.services[0].id, "opentree-watcher");
  assert.equal(typeof api.services[0].start, "function");
  assert.equal(typeof api.services[0].stop, "function");
});
