import { expect, test } from "@playwright/test";

const enabled = process.env.MUX_EXTERNAL_PERFORMANCE === "1";
const playbackId =
  process.env.MUX_PERFORMANCE_PLAYBACK_ID ??
  "a4nOgmxGWg6gULfcBbAa00gXyfcwPnAFldF8RdsNyk8M";

test.skip(!enabled, "External Mux performance test runs through test:mux-performance.");

test("Mux on-demand playback meets startup and rebuffer bounds", async ({ browser }) => {
  test.setTimeout(180_000);
  const startupSamples: number[] = [];
  const rebufferSamples: number[] = [];

  for (let index = 0; index < 10; index += 1) {
    const page = await browser.newPage();
    await page.goto(`https://player.mux.com/${playbackId}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const player = document.querySelector("mux-player") as
        | (HTMLElement & { media?: { nativeEl?: HTMLVideoElement } })
        | null;
      return Boolean(player?.media?.nativeEl);
    });
    const result = await page.evaluate(async () => {
      const player = document.querySelector("mux-player") as HTMLElement & {
        media: { nativeEl: HTMLVideoElement };
      };
      const video = player.media.nativeEl;
      video.muted = true;
      let waitingStarted: number | null = null;
      let rebufferMilliseconds = 0;
      const onWaiting = () => {
        waitingStarted ??= performance.now();
      };
      const onPlaying = () => {
        if (waitingStarted !== null) {
          rebufferMilliseconds += performance.now() - waitingStarted;
          waitingStarted = null;
        }
      };
      video.addEventListener("waiting", onWaiting);
      video.addEventListener("playing", onPlaying);
      const started = performance.now();
      await video.play();
      if (video.currentTime < 0.1) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (video.currentTime >= 0.1) resolve();
            else requestAnimationFrame(check);
          };
          check();
        });
      }
      const startupMilliseconds = performance.now() - started;
      rebufferMilliseconds = 0;
      waitingStarted = null;
      const observationStarted = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const observationMilliseconds = performance.now() - observationStarted;
      if (waitingStarted !== null) {
        rebufferMilliseconds += performance.now() - waitingStarted;
      }
      video.pause();
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      return {
        startupMilliseconds,
        rebufferRatio: rebufferMilliseconds / observationMilliseconds,
      };
    });
    startupSamples.push(result.startupMilliseconds);
    rebufferSamples.push(result.rebufferRatio);
    await page.close();
  }

  startupSamples.sort((left, right) => left - right);
  rebufferSamples.sort((left, right) => left - right);
  const metrics = {
    p50: percentile(startupSamples, 0.5),
    p95: percentile(startupSamples, 0.95),
    p99: percentile(startupSamples, 0.99),
    aggregateRebufferRatio:
      rebufferSamples.reduce((total, sample) => total + sample, 0) /
      rebufferSamples.length,
    maxRebufferRatio: rebufferSamples.at(-1) ?? 0,
  };
  console.log(`Mux playback metrics: ${JSON.stringify(metrics)}`);

  expect(metrics.p50).toBeLessThanOrEqual(1500);
  expect(metrics.p95).toBeLessThanOrEqual(3000);
  expect(metrics.p99).toBeLessThanOrEqual(5000);
  expect(metrics.aggregateRebufferRatio).toBeLessThan(0.01);
});

function percentile(samples: number[], quantile: number) {
  const index = Math.min(
    Math.max(Math.round((samples.length - 1) * quantile), 0),
    samples.length - 1,
  );
  return Math.round(samples[index] * 100) / 100;
}
