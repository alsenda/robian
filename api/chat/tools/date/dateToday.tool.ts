import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

export const dateTodayDef = toolDefinition({
  name: "date_today",
  description:
    "Return today's date in a human-readable format. Use this when the user asks for today's date or the current date.",
  inputSchema: z.object({}),
  outputSchema: z.string().describe("Today's date (en-US)"),
});

export const dateTodayTool = dateTodayDef.server(async () => {
  const today = new Date();
  return today.toLocaleDateString("en-US");
});
