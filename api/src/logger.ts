import { configure, getConsoleSink, getLogger } from "@logtape/logtape";
import { honoLogger } from "@logtape/hono";

await configure({
  sinks: {
    console: getConsoleSink(),
  },
  loggers: [
    {
      category: "my.fm",
      lowestLevel: "debug",
      sinks: ["console"],
    },
    {
      category: ["hono"],
      lowestLevel: "info",
      sinks: ["console"],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],
});

export const logger = getLogger("my.fm");
export const httpLogger = honoLogger({
  category: ["hono", "http"],
  level: "info",
  format: "dev",
});
