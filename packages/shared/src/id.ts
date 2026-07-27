const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare const brand: unique symbol;

/**
 * Branded UUID type — every primary/foreign key in `docs/architecture/01-data-model.md`
 * is a UUID. The brand prevents accidentally passing an arbitrary `string`
 * (e.g. a slug) where an entity ID is expected, without adding runtime cost.
 */
export type Uuid = string & { readonly [brand]: "Uuid" };

export function isUuid(value: string): value is Uuid {
  return UUID_PATTERN.test(value);
}

export function asUuid(value: string): Uuid {
  if (!isUuid(value)) {
    throw new Error(`Invalid UUID: "${value}"`);
  }
  return value;
}
