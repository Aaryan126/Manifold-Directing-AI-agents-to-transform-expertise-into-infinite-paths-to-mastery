const targets = [
  ["web", process.env.WEB_HEALTH_URL ?? "http://localhost:3000/api/health"],
  ["pipeline", process.env.PIPELINE_HEALTH_URL ?? "http://localhost:8000/health"],
];

for (const [name, url] of targets) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name} health check failed with ${response.status}`);
  }
  const body = await response.json();
  console.log(`${name}: ${body.status}`);
}
