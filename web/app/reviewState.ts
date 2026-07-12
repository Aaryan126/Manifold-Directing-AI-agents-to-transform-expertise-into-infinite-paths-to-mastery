export type ReviewStatus = "proposed" | "accepted" | "edited" | "dismissed" | string;

export function acceptButtonLabel(status: ReviewStatus): string {
  if (status === "accepted") return "Accepted";
  if (status === "edited") return "Edited";
  if (status === "dismissed") return "Dismissed";
  return "Accept AI suggestion";
}

export function acceptButtonDisabled(status: ReviewStatus): boolean {
  return status === "accepted" || status === "edited" || status === "dismissed";
}
