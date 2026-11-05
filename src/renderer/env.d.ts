/// <reference types="vite/client" />
import type { ClayBridge } from "../shared/bridge";

declare global {
  interface Window {
    /** Present only in Electron (exposed by the preload). */
    clay?: ClayBridge;
  }
}
export {};
