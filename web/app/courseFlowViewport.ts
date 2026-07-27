export type CourseFlowViewportPolicy = {
  density: "close" | "standard" | "overview";
  maxZoom: number;
  padding: number;
};

export function courseFlowViewportPolicy(unitCount: number): CourseFlowViewportPolicy {
  if (unitCount <= 1) {
    return { density: "close", maxZoom: 1.3, padding: 0.2 };
  }
  if (unitCount < 5) {
    return { density: "standard", maxZoom: 1.05, padding: 0.18 };
  }
  return { density: "overview", maxZoom: 0.82, padding: 0.2 };
}
