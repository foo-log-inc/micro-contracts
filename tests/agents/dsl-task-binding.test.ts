import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { taskRegistry } from "../../src/generated/dsl/tasks.js";
import { TASK_IDS } from "../../src/agents/types.js";

const contractPath = resolve(import.meta.dirname, "../../cli-contract.yaml");
const contract = parseYaml(readFileSync(contractPath, "utf8"));

function getCommands(): Record<string, { "x-agent"?: { dsl_task?: string } }> {
  const sets = contract.command_sets ?? {};
  const commands: Record<string, { "x-agent"?: { dsl_task?: string } }> = {};
  for (const setDef of Object.values(sets) as Array<{ commands?: Record<string, unknown> }>) {
    if (setDef.commands) {
      Object.assign(commands, setDef.commands);
    }
  }
  return commands;
}

describe("dsl_task binding consistency", () => {
  const commands = getCommands();

  const llmCommands = Object.entries(commands).filter(
    ([, cmd]) => cmd["x-agent"]?.dsl_task,
  );

  it("all LLM commands declare dsl_task in x-agent", () => {
    expect(llmCommands.length).toBe(4);
  });

  it.each(llmCommands)(
    "%s x-agent.dsl_task matches DSL task registry",
    (cmdName, cmd) => {
      const dslTask = cmd["x-agent"]!.dsl_task!;
      expect(taskRegistry[dslTask]).toBeDefined();
      expect(taskRegistry[dslTask].id).toBe(dslTask);
    },
  );

  it("TASK_IDS values all exist in the DSL task registry", () => {
    for (const [key, taskId] of Object.entries(TASK_IDS)) {
      expect(taskRegistry[taskId]).toBeDefined();
      expect(taskRegistry[taskId].id).toBe(taskId);
    }
  });

  it("TASK_IDS covers all dsl_task declarations in the contract", () => {
    const contractTaskIds = llmCommands.map(([, cmd]) => cmd["x-agent"]!.dsl_task!);
    const registeredTaskIds = Object.values(TASK_IDS);
    for (const taskId of contractTaskIds) {
      expect(registeredTaskIds).toContain(taskId);
    }
  });
});
