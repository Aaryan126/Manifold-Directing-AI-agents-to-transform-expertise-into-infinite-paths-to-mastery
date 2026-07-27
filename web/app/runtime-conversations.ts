type AssistantKind = "course-director" | "learning-assistant";

const conversations = new Map<string, unknown[]>();

function conversationKey(
  kind: AssistantKind,
  userId: string,
  courseId: string,
) {
  return `${kind}:${userId}:${courseId}`;
}

export function readRuntimeConversation<T>(
  kind: AssistantKind,
  userId: string,
  courseId: string,
): T[] {
  return [...(conversations.get(conversationKey(kind, userId, courseId)) ?? [])] as T[];
}

export function writeRuntimeConversation<T>(
  kind: AssistantKind,
  userId: string,
  courseId: string,
  messages: T[],
) {
  conversations.set(conversationKey(kind, userId, courseId), [...messages]);
}

export function clearRuntimeConversations() {
  conversations.clear();
}
