import {
  liveNotRunExitCode,
  runLiveNativeSmoke,
  sanitizeForTranscript,
} from "./runtime-smoke-harness";

const report = await runLiveNativeSmoke();
console.log(JSON.stringify(sanitizeForTranscript(report), null, 2));
process.exitCode =
  report.status === "PASS"
    ? 0
    : report.status === "NOT_RUN"
      ? liveNotRunExitCode
      : 1;
