import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg } from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "",
  dirs: ["./src/trigger"],
  maxDuration: 7200,
  build: {
    extensions: [ffmpeg(), prismaExtension({ mode: "legacy", schema: "prisma/schema.prisma" })],
  },
});
