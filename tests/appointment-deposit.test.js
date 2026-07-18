import assert from "node:assert/strict";
import test from "node:test";

import { appointmentDepositAmount } from "../api/data.js";

test("appointmentDepositAmount charges the configured deposit for inventory services", () => {
  assert.equal(
    appointmentDepositAmount(
      { offer_inventory_items: true, deposit_amount: 50, is_free: false },
      410,
    ),
    50,
  );
});

test("appointmentDepositAmount never charges more than the final price or free services", () => {
  assert.equal(appointmentDepositAmount({ deposit_amount: 50 }, 30), 30);
  assert.equal(appointmentDepositAmount({ deposit_amount: 50, is_free: true }, 410), 0);
});
