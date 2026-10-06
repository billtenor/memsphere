// Measure the whole workflow from creation, including job dependencies and queueing.
const { GITHUB_API_URL = "https://api.github.com", GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_TOKEN } = process.env;
const response = await fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`, {
  headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" }
});
if (!response.ok) throw new Error(`Cannot read workflow timing: HTTP ${response.status}`);
const run = await response.json();
const start = run.run_attempt > 1 ? run.run_started_at : run.created_at;
const seconds = (Date.now() - Date.parse(start)) / 1000;
console.log(`Workflow elapsed, including queueing: ${seconds.toFixed(1)}s / 300s`);
// Reserve time for this job's cleanup and the final GitHub completion event.
if (seconds > 285) throw new Error("Workflow exceeds the five-minute performance budget (15s completion reserve)");
