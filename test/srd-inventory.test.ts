import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addItem,
  removeItem,
  equipItem,
  unequipItem,
  totalWeight,
  carryingCapacity,
  isEncumbered,
} from "../server/srd/inventory.js";
import type { Inventory } from "../server/srd/types.js";

const empty: Inventory = { items: [] };

test("addItem appends a new stack", () => {
  const inv = addItem(empty, { id: "torch", name: "Torch", weight: 1, quantity: 3 });
  assert.equal(inv.items.length, 1);
  assert.deepEqual(inv.items[0], { id: "torch", name: "Torch", weight: 1, quantity: 3 });
});

test("addItem stacks an existing id by adding quantities", () => {
  let inv = addItem(empty, { id: "torch", name: "Torch", weight: 1, quantity: 2 });
  inv = addItem(inv, { id: "torch", name: "Torch", weight: 1 }, 5);
  assert.equal(inv.items.length, 1);
  assert.equal(inv.items[0]!.quantity, 7);
});

test("addItem rejects quantity < 1", () => {
  assert.throws(() => addItem(empty, { id: "x", name: "X", weight: 1 }, 0), />= 1/);
  assert.throws(() => addItem(empty, { id: "x", name: "X", weight: 1 }, 1.5), />= 1/);
});

test("removeItem with no quantity removes the entire stack", () => {
  let inv = addItem(empty, { id: "torch", name: "Torch", weight: 1, quantity: 3 });
  inv = removeItem(inv, "torch");
  assert.deepEqual(inv.items, []);
});

test("removeItem with quantity decrements without dropping the row", () => {
  let inv = addItem(empty, { id: "torch", name: "Torch", weight: 1, quantity: 5 });
  inv = removeItem(inv, "torch", 2);
  assert.equal(inv.items[0]!.quantity, 3);
});

test("removeItem with quantity >= stack drops the row", () => {
  let inv = addItem(empty, { id: "torch", name: "Torch", weight: 1, quantity: 2 });
  inv = removeItem(inv, "torch", 5);
  assert.deepEqual(inv.items, []);
});

test("removeItem on a missing id is a no-op", () => {
  const inv = addItem(empty, { id: "torch", name: "Torch", weight: 1, quantity: 2 });
  const out = removeItem(inv, "doesntexist");
  assert.deepEqual(out, inv);
});

test("equipItem flips the equipped flag; unequipItem clears it", () => {
  let inv = addItem(empty, { id: "sword", name: "Longsword", weight: 3, quantity: 1 });
  inv = equipItem(inv, "sword");
  assert.equal(inv.items[0]!.equipped, true);
  inv = unequipItem(inv, "sword");
  assert.equal(inv.items[0]!.equipped, undefined, "unequip drops the flag");
});

test("equipItem throws when item is not in inventory", () => {
  assert.throws(() => equipItem(empty, "no-such-item"), /not in inventory/);
});

test("totalWeight sums weight × quantity", () => {
  let inv = addItem(empty, { id: "torch", name: "Torch", weight: 1, quantity: 3 });
  inv = addItem(inv, { id: "rations", name: "Rations", weight: 2, quantity: 5 });
  // 1*3 + 2*5 = 13
  assert.equal(totalWeight(inv), 13);
});

test("carryingCapacity = STR × 15", () => {
  assert.equal(carryingCapacity(10), 150);
  assert.equal(carryingCapacity(16), 240);
  assert.equal(carryingCapacity(20), 300);
  assert.throws(() => carryingCapacity(0), />= 1/);
});

test("isEncumbered accepts a number or character with str", () => {
  let inv = addItem(empty, { id: "stones", name: "Big Stones", weight: 50, quantity: 5 }); // 250 lb
  assert.equal(isEncumbered(10, inv), true,  "STR 10 cap=150, 250 lb total → encumbered");
  assert.equal(isEncumbered(20, inv), false, "STR 20 cap=300, 250 lb total → fine");
  assert.equal(isEncumbered({ abilities: { str: 10 } }, inv), true);
  assert.equal(isEncumbered({ abilities: { str: 20 } }, inv), false);

  // Boundary: total == cap is NOT encumbered (strict >).
  inv = removeItem(inv, "stones", 4); // leaves 1 × 50 lb = 50
  inv = addItem(inv, { id: "fillers", name: "Fillers", weight: 100, quantity: 1 }); // total 150
  assert.equal(isEncumbered(10, inv), false, "exactly at cap is not encumbered");
});
