#!/usr/bin/env bun
import { bootstrapCapabilities } from "../bootstrap";
import { runStdio } from "./server";

await runStdio(
  bootstrapCapabilities(process.env.PULSO_WORKSPACE ?? process.cwd()),
);
