/**
 * Barrel export for the domain core.
 *
 * API routes and the frontend import from "@/lib" — a stable surface that hides
 * which file a thing lives in. Keep this list curated.
 */

export * from "./types";
export * from "./repository";
export * from "./memory-repository";
export * from "./sqlite-repository";
export * from "./ids";
export * from "./ledger";
export * from "./finance";
export * from "./reclaim";
export * from "./templates";
export * from "./licenses";
export * from "./assets";
export * from "./ai";
