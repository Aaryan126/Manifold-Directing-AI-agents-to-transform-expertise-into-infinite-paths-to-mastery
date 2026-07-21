import { describe, expect, it } from "vitest";

import {
  clearDevelopmentSession,
  developmentDestination,
  developmentSessionKey,
  instructorStorageKey,
  learnerStorageKey,
  readDevelopmentSession,
  saveDevelopmentSession,
} from "../app/developmentSession";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("development session", () => {
  it("persists a role-aware identity and legacy compatibility key", () => {
    const storage = memoryStorage();
    saveDevelopmentSession(storage, {
      id: "learner-1",
      display_name: "Brian",
      role: "learner",
    });

    expect(readDevelopmentSession(storage)).toEqual({
      id: "learner-1",
      display_name: "Brian",
      role: "learner",
      email: undefined,
    });
    expect(storage.getItem(learnerStorageKey)).toBe("learner-1");
    expect(developmentDestination("learner")).toBe("/learn");
    expect(developmentDestination("instructor")).toBe("/app");
  });

  it("rejects malformed state and clears every development identity key", () => {
    const storage = memoryStorage();
    storage.setItem(developmentSessionKey, "not-json");
    storage.setItem(instructorStorageKey, "instructor-1");
    storage.setItem(learnerStorageKey, "learner-1");
    expect(readDevelopmentSession(storage)).toBeNull();

    clearDevelopmentSession(storage);
    expect(storage.getItem(developmentSessionKey)).toBeNull();
    expect(storage.getItem(instructorStorageKey)).toBeNull();
    expect(storage.getItem(learnerStorageKey)).toBeNull();
  });
});
