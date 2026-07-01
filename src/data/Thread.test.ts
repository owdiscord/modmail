import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { UnicodePeriod } from "../style";
import { formatUsernameForChannel } from "./Thread";

test("usernames are formatted for discord channels", () => {
  const values = {
    noryasta: "noryasta",
    "jules.jpg": `jules${UnicodePeriod}jpg`,
    ___thatonegamer: "___thatonegamer",
    _thegodminecraft_: "_thegodminecraft_",
    "": "unknown",
  };

  for (const [input, expectation] of Object.entries(values)) {
    assert(formatUsernameForChannel(input), expectation);
  }
});
