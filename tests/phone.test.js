import test from "node:test";
import assert from "node:assert/strict";

import {
  brazilianPhoneCandidates,
  normalizeBrazilianPhone,
} from "../server/lib/phone.js";

test("stores Brazilian WhatsApp in one canonical format", () => {
  assert.equal(normalizeBrazilianPhone("14997334865"), "5514997334865");
  assert.equal(normalizeBrazilianPhone("+55 (14) 99733-4865"), "5514997334865");
  assert.equal(normalizeBrazilianPhone("5514997334865"), "5514997334865");
});

test("matches local and country-code forms as the same WhatsApp", () => {
  assert.deepEqual(
    brazilianPhoneCandidates("5514997334865"),
    ["5514997334865", "14997334865"],
  );
});

test("rejects incomplete WhatsApp numbers", () => {
  assert.equal(normalizeBrazilianPhone("997334865"), "");
});
