import { afterEach, describe, expect, it } from "vitest";
import type { Response } from "express";
import { addStreamClient, broadcast, getConnectedBoothCount } from "./realtime";

function responseMock() {
  const written: string[] = [];
  const response = {
    write: (chunk: string) => { written.push(chunk); return true; },
    end: () => undefined,
  } as unknown as Response;
  return { response, written };
}

const clients: Array<{ close: () => void }> = [];
afterEach(() => {
  clients.splice(0).forEach(client => client.close());
});

describe("event-scoped live streams", () => {
  it("buffers updates until activation and never crosses event boundaries", () => {
    const firstEvent = responseMock();
    const otherEvent = responseMock();
    const firstStream = addStreamClient("event_alpha123", firstEvent.response, null);
    const otherStream = addStreamClient("event_bravo456", otherEvent.response, null);
    clients.push(firstStream, otherStream);

    broadcast("event_alpha123", "photo", { id: "photo-1", eventId: "event_alpha123" });
    expect(firstEvent.written).toHaveLength(0);
    expect(otherEvent.written).toHaveLength(0);

    firstStream.activate();
    otherStream.activate();
    expect(firstEvent.written.some(chunk => chunk.includes('"id":"photo-1"'))).toBe(true);
    expect(otherEvent.written).toHaveLength(0);

    broadcast("event_alpha123", "branding", { event: { id: "event_alpha123" } });
    expect(firstEvent.written.some(chunk => chunk.includes('"event":{"id":"event_alpha123"}'))).toBe(true);
    expect(otherEvent.written).toHaveLength(0);
  });

  it("tracks booth presence and keeps camera streams free of photo traffic", () => {
    const booth = responseMock();
    const display = responseMock();
    const boothStream = addStreamClient("event_charlie789", booth.response, "booth-1");
    const displayStream = addStreamClient("event_charlie789", display.response, null);
    clients.push(boothStream, displayStream);

    expect(getConnectedBoothCount("event_charlie789")).toBe(1);
    broadcast("event_charlie789", "photo", { id: "photo-2" });
    expect(booth.written.some(chunk => chunk.includes('"id":"photo-2"'))).toBe(false);

    displayStream.activate();
    expect(display.written.some(chunk => chunk.includes('"id":"photo-2"'))).toBe(true);
    boothStream.close();
    expect(getConnectedBoothCount("event_charlie789")).toBe(0);
  });
});
