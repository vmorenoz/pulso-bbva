#!/usr/bin/env bun
import { bootstrapCapabilities } from "../bootstrap";
import { assertActivePulsoBuild } from "../opencode/build-integrity";
import { runStdio } from "./server";

const activeBuild = assertActivePulsoBuild();

await runStdio(
  bootstrapCapabilities(process.env.PULSO_WORKSPACE ?? process.cwd(), {
    buildId:
      activeBuild?.buildId ??
      (typeof __PULSO_BUILD_ID__ === "string"
        ? __PULSO_BUILD_ID__
        : "development"),
  }),
);

declare const __PULSO_BUILD_ID__: string;
