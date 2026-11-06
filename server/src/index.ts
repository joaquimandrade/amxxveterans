import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import { Arena } from "./arena.ts";

const port = Number(process.env.PORT ?? 8091);
const host = process.env.HOST ?? "127.0.0.1";
const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../client/dist");

const gameServer = new Server({
  transport: new WebSocketTransport(),
  express: (expressApp) => {
    expressApp.use(express.static(clientDist));
  },
});

gameServer.define("arena", Arena);
await gameServer.listen(port, host);
console.log(`arena on http://${host}:${port}`);
