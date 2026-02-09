import { describe, it, expect } from "vitest";

const { getPromptPrefixMessagesForModel, SYSTEM_PROMPT } = await import("../../chat/systemPrompt.ts");

describe("system prompt (autonomous RAG policy)", () => {
  const header = "Local files and RAG (autonomous use):";
  const balancedHeader = "Balanced RAG + Knowledge Prompt (No Hallucination, No Paralysis) — System Prompt:";

  it("SYSTEM_PROMPT contains the autonomous RAG policy block", () => {
    expect(SYSTEM_PROMPT).toContain(header);
  });

  it("SYSTEM_PROMPT contains the balanced RAG + knowledge policy block", () => {
    expect(SYSTEM_PROMPT).toContain(balancedHeader);
  });

  it("prompt prefix for Robian contains the autonomous RAG policy block", () => {
    const msgs = getPromptPrefixMessagesForModel("robian:latest");
    expect(msgs.length).toBe(1);
    expect(String(msgs[0]?.content || "")).toContain(header);
  });

  it("prompt prefix for Robian contains the balanced RAG + knowledge policy block", () => {
    const msgs = getPromptPrefixMessagesForModel("robian:latest");
    expect(msgs.length).toBe(1);
    expect(String(msgs[0]?.content || "")).toContain(balancedHeader);
  });

  it("prompt prefix for non-Robian models contains the autonomous RAG policy block", () => {
    const msgs = getPromptPrefixMessagesForModel("llama3.1");
    expect(msgs.length).toBe(1);
    expect(String(msgs[0]?.content || "")).toContain(header);
  });

  it("prompt prefix for non-Robian models contains the balanced RAG + knowledge policy block", () => {
    const msgs = getPromptPrefixMessagesForModel("llama3.1");
    expect(msgs.length).toBe(1);
    expect(String(msgs[0]?.content || "")).toContain(balancedHeader);
  });
});
