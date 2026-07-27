import { beforeEach, describe, expect, it } from "vitest";

import {
  clearRuntimeConversations,
  readRuntimeConversation,
  writeRuntimeConversation,
} from "../app/runtime-conversations";
import {
  clearDevelopmentSession,
  saveDevelopmentSession,
} from "../app/developmentSession";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("runtime assistant conversations", () => {
  beforeEach(() => {
    clearRuntimeConversations();
  });

  it("keeps messages in memory and isolates them by assistant, user, and course", () => {
    writeRuntimeConversation("course-director", "teacher-1", "course-1", [
      { role: "instructor", content: "Draft a recap." },
    ]);

    expect(
      readRuntimeConversation("course-director", "teacher-1", "course-1"),
    ).toEqual([{ role: "instructor", content: "Draft a recap." }]);
    expect(
      readRuntimeConversation("course-director", "teacher-1", "course-2"),
    ).toEqual([]);
    expect(
      readRuntimeConversation("learning-assistant", "teacher-1", "course-1"),
    ).toEqual([]);
  });

  it("returns copies so callers cannot mutate cached history accidentally", () => {
    const message = { role: "learner", content: "Help me review." };
    writeRuntimeConversation("learning-assistant", "learner-1", "course-1", [
      message,
    ]);

    const read = readRuntimeConversation<typeof message>(
      "learning-assistant",
      "learner-1",
      "course-1",
    );
    read.push({ role: "guide", content: "Let’s start." });

    expect(
      readRuntimeConversation("learning-assistant", "learner-1", "course-1"),
    ).toEqual([message]);
  });

  it("starts clean whenever a login is saved or the user logs out", () => {
    const storage = memoryStorage();
    writeRuntimeConversation("course-director", "teacher-1", "course-1", [
      { role: "instructor", content: "Old login message" },
    ]);

    saveDevelopmentSession(storage, {
      id: "teacher-1",
      display_name: "David",
      role: "instructor",
    });
    expect(
      readRuntimeConversation("course-director", "teacher-1", "course-1"),
    ).toEqual([]);

    writeRuntimeConversation("learning-assistant", "learner-1", "course-1", [
      { role: "learner", content: "Current login message" },
    ]);
    clearDevelopmentSession(storage);
    expect(
      readRuntimeConversation("learning-assistant", "learner-1", "course-1"),
    ).toEqual([]);
  });
});
