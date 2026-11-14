#!/usr/bin/env node
process.env.AUDITFLOW_RELEASE_VERSION = "7.7.0";
await import("./package-7.5-launcher.mjs");
