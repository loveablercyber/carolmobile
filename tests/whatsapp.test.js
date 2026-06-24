import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStatus, qrValue } from "../api/whatsapp.js";

test("normalizeStatus maps various provider values correctly", () => {
  const cases = [
    { input: { status: "OPEN" }, expected: "connected" },
    { input: { state: "connected" }, expected: "connected" },
    { input: { instance: { state: "online" } }, expected: "connected" },
    { input: { connectionStatus: "open" }, expected: "connected" },

    { input: { status: "connecting" }, expected: "connecting" },
    { input: { state: "starting" }, expected: "connecting" },

    { input: { status: "close" }, expected: "disconnected" },
    { input: { state: "closed" }, expected: "disconnected" },
    { input: { instance: { state: "disconnected" } }, expected: "disconnected" },
    { input: { connectionStatus: "offline" }, expected: "disconnected" },

    { input: {}, expected: "disconnected" },
    { input: null, expected: "disconnected" },
    { input: { status: "unknown" }, expected: "unknown" },
  ];

  for (const { input, expected } of cases) {
    assert.equal(normalizeStatus(input), expected);
  }
});

test("qrValue extracts base64 or code from different schemas", () => {
  assert.equal(qrValue({ qr_code_data: "data1" }), "data1");
  assert.equal(qrValue({ qrCode: "data2" }), "data2");
  assert.equal(qrValue({ qrcode: { base64: "data3" } }), "data3");
  assert.equal(qrValue({ base64: "data4" }), "data4");
  assert.equal(qrValue({ qr: "data5" }), "data5");
  assert.equal(qrValue({ code: "data6" }), "data6");
  assert.equal(qrValue({}), null);
  assert.equal(qrValue(null), null);
});
