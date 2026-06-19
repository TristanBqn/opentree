import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStats, parseInspect, parseFindOutput } from "../lib/docker.mjs";

const NOW = Date.UTC(2026, 5, 12, 12, 0, 0);

test("parseStats computes cpu percent and memory MiB", () => {
  const raw = {
    cpu_stats: {
      cpu_usage: { total_usage: 2000 },
      system_cpu_usage: 10000,
      online_cpus: 4,
    },
    precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 6000 },
    memory_stats: { usage: 355 * 1048576 },
  };
  const s = parseStats(raw);
  // cpuDelta=1000, systemDelta=4000 → 1000/4000*4*100 = 100
  assert.equal(Math.round(s.cpuPct), 100);
  assert.equal(Math.round(s.memMiB), 355);
});

test("parseStats returns zeros on missing fields", () => {
  const s = parseStats({});
  assert.equal(s.cpuPct, 0);
  assert.equal(s.memMiB, 0);
});

test("parseInspect maps health status", () => {
  const raw = {
    State: {
      Status: "running",
      StartedAt: new Date(NOW - 18 * 60000).toISOString(),
      Health: { Status: "healthy" },
    },
    NetworkSettings: { Ports: {} },
  };
  const r = parseInspect(raw, NOW);
  assert.equal(r.status, "healthy");
  assert.match(r.statusTxt, /healthy/);
  assert.match(r.statusTxt, /up 18 min/);
});

test("parseInspect treats running-without-health as ok", () => {
  const raw = {
    State: {
      Status: "running",
      StartedAt: new Date(NOW - 3600000).toISOString(),
    },
    NetworkSettings: { Ports: {} },
  };
  assert.equal(parseInspect(raw, NOW).status, "ok");
});

test("parseFindOutput builds a nested tree", () => {
  const text = [
    "d\t4096\t1718000000\t/app",
    "f\t512\t1718000001\t/app/index.js",
    "d\t4096\t1718000002\t/app/dist",
    "f\t99\t1718000003\t/app/dist/server.js",
  ].join("\n");
  let id = 0;
  const tree = parseFindOutput(text, "c1:/app", () => ++id);
  assert.equal(tree.name, "c1:/app");
  assert.equal(tree.type, "dir");
  const dist = tree.children.find((c) => c.name === "dist");
  assert.equal(dist.type, "dir");
  assert.equal(dist.children[0].name, "server.js");
  assert.equal(dist.children[0].ext, "js");
});

test("parseFindOutput returns an empty root for empty input", () => {
  const tree = parseFindOutput("", "c1:/app", () => 0);
  assert.equal(tree.type, "dir");
  assert.equal(tree.children.length, 0);
});
