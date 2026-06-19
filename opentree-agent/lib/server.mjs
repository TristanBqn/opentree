import http from "node:http";
import { createRequestHandler } from "./handlers.mjs";

export function createServer({ staticDir, cache, prefix = "" }) {
  return http.createServer(createRequestHandler({ staticDir, cache, prefix }));
}
