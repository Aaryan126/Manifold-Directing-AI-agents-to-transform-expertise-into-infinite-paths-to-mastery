const targets = [
  ["web", "http://127.0.0.1:3000/api/health"],
  ["pipeline", "http://127.0.0.1:8000/health"],
];

for (const [name, url] of targets) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name} health check failed with ${response.status}`);
  }
  const body = await response.json();
  console.log(`${name}: ${body.status}`);
}
