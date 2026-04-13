import { configure, getConsoleSink, getLogger } from "@logtape/logtape";
import { honoLogger } from "@logtape/hono";
import { getPrettyFormatter, prettyFormatter } from "@logtape/pretty";
import { getLogger as getDrizzleLogger } from "@logtape/drizzle-orm";
import { env } from "./env";

const logLevel = env.LOG_LEVEL;

await configure({
  sinks: {
    console: getConsoleSink({
      formatter: getPrettyFormatter({
        wordWrap: false,
      }),
    }),
  },
  loggers: [
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
    {
      category: "my.fm",
      lowestLevel: logLevel,
      sinks: ["console"],
    },
    {
      category: ["hono"],
      lowestLevel: logLevel,
      sinks: ["console"],
    },
    {
      category: ["drizzle", "db"],
      lowestLevel: logLevel,
      sinks: ["console"],
    },
  ],
});

export const logger = getLogger("my.fm");

export const httpLogger = honoLogger({
  category: ["hono", "http"],
  level: "trace",
  format: "dev",
});

export const drizzleLogger = getDrizzleLogger({ category: ["drizzle", "db"], level: "debug" });
