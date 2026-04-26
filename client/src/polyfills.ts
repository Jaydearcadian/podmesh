import { Buffer } from "buffer";

if (typeof globalThis !== "undefined") {
  (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer = Buffer;
}
