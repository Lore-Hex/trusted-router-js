/** Runtime boundary for JSON-shaped objects (arrays and null are not records). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read only data owned by a record; prototype names are unknown unless explicit. */
export function ownProperty<T>(object: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/** Copy an external key without invoking Object.prototype.__proto__'s setter. */
export function setOwn(object: object, key: string, value: unknown): void {
  Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("Expected a JSON object");
  return value;
}

export function errorText(error: unknown): string {
  return isRecord(error) && typeof error.message === "string" ? error.message : String(error);
}
