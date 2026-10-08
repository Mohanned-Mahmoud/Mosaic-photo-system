import { uuidSchema } from "../../../../shared/mosaic";

const BOOTH_STORAGE_KEY = "mosaic.booth-id.v1";

export function getOrCreateBoothId(): string {
  try {
    const current = localStorage.getItem(BOOTH_STORAGE_KEY);
    const parsed = uuidSchema.safeParse(current);
    if (parsed.success) return parsed.data;

    const next = crypto.randomUUID();
    localStorage.setItem(BOOTH_STORAGE_KEY, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}
