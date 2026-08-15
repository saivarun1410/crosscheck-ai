import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, parseConfig } from "../src/config.js";

test("parseConfig applies safe defaults", () => {
  const config = parseConfig(`version: 1\nagents: {}`);
  assert.equal(config.agents.author.adapter, "codex");
  assert.equal(config.agents.reviewer.adapter, "claude");
  assert.equal(config.workspace.requireClean, true);
  assert.equal(config.policy.maxReviewRounds, 2);
});

test("parseConfig accepts role reversal and verification commands", () => {
  const config = parseConfig(`
version: 1
agents:
  author: { adapter: claude, command: claude, model: opus }
  reviewer: { adapter: codex, command: codex }
verification:
  commands: [npm test]
policy:
  failOn: medium
  minimumConfidence: 0.8
`);
  assert.equal(config.agents.author.adapter, "claude");
  assert.equal(config.agents.author.model, "opus");
  assert.deepEqual(config.verification.commands, ["npm test"]);
  assert.equal(config.policy.failOn, "medium");
});

test("parseConfig rejects unknown adapters and unsafe bounds", () => {
  assert.throws(
    () => parseConfig(`version: 1\nagents:\n  author: { adapter: mystery }`),
    ConfigError,
  );
  assert.throws(
    () => parseConfig(`version: 1\nagents: {}\npolicy:\n  maxReviewRounds: 0`),
    /maxReviewRounds/,
  );
});
