/**
 * Inventory — pure functional add/remove/equip/weight helpers.
 *
 * Items are stacked by id; quantity adds atomically when an item with
 * the same id is already present. Equip/unequip is a per-item flag.
 * Weight is per-unit — total weight = sum(weight × quantity).
 */

import type { Inventory, Item } from "./types.js";

/**
 * Add an item to an inventory. If an item with the same id already
 * exists, its quantity is incremented; otherwise the item is appended.
 *
 * The supplied `item.quantity` is the default added amount; a separate
 * `quantity` argument overrides it. Both must be at least 1.
 */
export function addItem(
  inventory: Inventory,
  item: Omit<Item, "quantity"> & { quantity?: number },
  quantity?: number,
): Inventory {
  const qty = quantity ?? item.quantity ?? 1;
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error(`add quantity must be an integer >= 1: ${qty}`);
  }

  const existing = inventory.items.find(i => i.id === item.id);
  if (existing) {
    return {
      ...inventory,
      items: inventory.items.map(i =>
        i.id === item.id ? { ...i, quantity: i.quantity + qty } : i,
      ),
    };
  }

  const fresh: Item = {
    id: item.id,
    name: item.name,
    weight: item.weight,
    quantity: qty,
    ...(item.equipped ? { equipped: true } : {}),
  };
  return { ...inventory, items: [...inventory.items, fresh] };
}

/**
 * Remove items by id. With `quantity` undefined, the entire stack is
 * removed. With `quantity` >= the current stack, the row is dropped.
 * Removing an item that isn't present is a no-op (returns the input).
 */
export function removeItem(
  inventory: Inventory,
  itemId: string,
  quantity?: number,
): Inventory {
  const existing = inventory.items.find(i => i.id === itemId);
  if (!existing) return inventory;

  const removeAll = quantity === undefined;
  if (!removeAll && (!Number.isInteger(quantity) || (quantity as number) < 1)) {
    throw new Error(`remove quantity must be an integer >= 1: ${quantity}`);
  }

  if (removeAll || (quantity as number) >= existing.quantity) {
    return { ...inventory, items: inventory.items.filter(i => i.id !== itemId) };
  }

  return {
    ...inventory,
    items: inventory.items.map(i =>
      i.id === itemId ? { ...i, quantity: i.quantity - (quantity as number) } : i,
    ),
  };
}

export function equipItem(inventory: Inventory, itemId: string): Inventory {
  if (!inventory.items.some(i => i.id === itemId)) {
    throw new Error(`cannot equip: item ${itemId} not in inventory`);
  }
  return {
    ...inventory,
    items: inventory.items.map(i => (i.id === itemId ? { ...i, equipped: true } : i)),
  };
}

export function unequipItem(inventory: Inventory, itemId: string): Inventory {
  return {
    ...inventory,
    items: inventory.items.map(i => {
      if (i.id !== itemId) return i;
      // Drop the equipped flag entirely rather than leaving false in JSON.
      const { equipped: _equipped, ...rest } = i;
      return { ...rest };
    }),
  };
}

export function totalWeight(inventory: Inventory): number {
  return inventory.items.reduce((sum, i) => sum + i.weight * i.quantity, 0);
}

/**
 * SRD carrying capacity (in pounds) = STR × 15. The encumbrance variant
 * rules are NOT applied in this slice; isEncumbered returns true when
 * total weight strictly exceeds the cap.
 */
export function carryingCapacity(strengthScore: number): number {
  if (!Number.isFinite(strengthScore) || strengthScore < 1) {
    throw new Error("strengthScore must be a finite number >= 1");
  }
  return strengthScore * 15;
}

export function isEncumbered(
  characterOrStrength: number | { abilities: { str: number } },
  inventory: Inventory,
): boolean {
  const str = typeof characterOrStrength === "number"
    ? characterOrStrength
    : characterOrStrength.abilities.str;
  return totalWeight(inventory) > carryingCapacity(str);
}
