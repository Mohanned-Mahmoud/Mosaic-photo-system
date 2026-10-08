import type { Response } from "express";

interface StreamClient {
  response: Response;
  boothId: string | null;
  ready: boolean;
  pending: Array<{ event: string; payload: unknown; id?: string }>;
}

const clientsByEvent = new Map<string, Set<StreamClient>>();
const MAX_PENDING_EVENTS = 64;

function writeEvent(client: StreamClient, event: string, payload: unknown, id?: string): boolean {
  const idLine = id ? `id: ${id}\n` : "";
  const data = JSON.stringify(payload);
  return client.response.write(`${idLine}event: ${event}\ndata: ${data}\n\n`);
}

function publishPresence(eventId: string): void {
  const count = getConnectedBoothCount(eventId);
  broadcast(eventId, "presence", { connectedBooths: count });
}

export function addStreamClient(eventId: string, response: Response, boothId: string | null): { activate: () => void; close: () => void } {
  const client: StreamClient = { response, boothId, ready: false, pending: [] };
  const eventClients = clientsByEvent.get(eventId) ?? new Set<StreamClient>();
  eventClients.add(client);
  clientsByEvent.set(eventId, eventClients);
  if (boothId) publishPresence(eventId);

  let closed = false;
  return {
    activate: () => {
      if (closed) return;
      client.ready = true;
      for (const item of client.pending) {
        if (!writeEvent(client, item.event, item.payload, item.id)) {
          client.response.end();
          break;
        }
      }
      client.pending = [];
    },
    close: () => {
    if (closed) return;
    closed = true;
    const current = clientsByEvent.get(eventId);
    current?.delete(client);
    if (current?.size === 0) clientsByEvent.delete(eventId);
    if (boothId) publishPresence(eventId);
    },
  };
}

export function getConnectedBoothCount(eventId: string): number {
  const boothIds = new Set<string>();
  for (const client of clientsByEvent.get(eventId) ?? []) {
    if (client.boothId) boothIds.add(client.boothId);
  }
  return boothIds.size;
}

export function broadcast(eventId: string, event: "photo" | "control" | "presence" | "photo-hidden" | "branding", payload: unknown, id?: string): void {
  const clients = clientsByEvent.get(eventId);
  if (!clients) return;
  for (const client of clients) {
    if (client.boothId && event !== "presence") continue;
    if (!client.ready) {
      if (client.pending.length >= MAX_PENDING_EVENTS) {
        client.response.end();
        clients.delete(client);
      } else {
        client.pending.push({ event, payload, id });
      }
      continue;
    }
    if (!writeEvent(client, event, payload, id)) {
      client.response.end();
      clients.delete(client);
    }
  }
  if (clients.size === 0) clientsByEvent.delete(eventId);
}

export function publishPhoto(eventId: string, photoId: string, payload: unknown): void {
  broadcast(eventId, "photo", payload, photoId);
}

export function publishControl(eventId: string, revision: number, payload: unknown): void {
  broadcast(eventId, "control", payload, `control-${revision}`);
}
