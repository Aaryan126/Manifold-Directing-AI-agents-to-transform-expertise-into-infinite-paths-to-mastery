import { clearRuntimeConversations } from "./runtime-conversations";

export type DevelopmentSession = {
  id: string;
  email?: string;
  display_name: string;
  role: "instructor" | "learner";
};

export const developmentSessionKey = "manifold.development-session";
export const instructorStorageKey = "manifold.teacher-id";
export const learnerStorageKey = "manifold.learner-id";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readDevelopmentSession(storage: StorageLike): DevelopmentSession | null {
  const serialized = storage.getItem(developmentSessionKey);
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Partial<DevelopmentSession>;
    if (
      typeof value.id !== "string" ||
      typeof value.display_name !== "string" ||
      (value.role !== "instructor" && value.role !== "learner")
    ) {
      return null;
    }
    return {
      id: value.id,
      email: typeof value.email === "string" ? value.email : undefined,
      display_name: value.display_name,
      role: value.role,
    };
  } catch {
    return null;
  }
}

export function saveDevelopmentSession(storage: StorageLike, session: DevelopmentSession) {
  clearRuntimeConversations();
  storage.setItem(developmentSessionKey, JSON.stringify(session));
  storage.setItem(
    session.role === "instructor" ? instructorStorageKey : learnerStorageKey,
    session.id,
  );
}

export function clearDevelopmentSession(storage: StorageLike) {
  clearRuntimeConversations();
  storage.removeItem(developmentSessionKey);
  storage.removeItem(instructorStorageKey);
  storage.removeItem(learnerStorageKey);
}

export function developmentDestination(role: DevelopmentSession["role"]) {
  return role === "instructor" ? "/app" : "/learn";
}
