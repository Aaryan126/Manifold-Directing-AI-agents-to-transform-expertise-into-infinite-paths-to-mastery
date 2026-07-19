export function formatTimecode(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  const minuteText = hours > 0 ? minutes.toString().padStart(2, "0") : minutes.toString();
  const secondText = remainingSeconds.toString().padStart(2, "0");

  return hours > 0 ? `${hours}:${minuteText}:${secondText}` : `${minuteText}:${secondText}`;
}

export function parseTimecode(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  const values = parts.map(Number);
  if (parts.length === 1) return values[0];
  if (values.at(-1)! >= 60) return null;
  if (parts.length === 2) return values[0] * 60 + values[1];
  if (values[1] >= 60) return null;
  return values[0] * 3600 + values[1] * 60 + values[2];
}
