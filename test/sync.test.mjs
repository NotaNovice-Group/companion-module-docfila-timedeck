// lib/timedeck-client.mjs and lib/timer.mjs are copies (see
// integrations/timedeck/sync.mjs). Inside the DocFila repo they must match
// their sources; in a published package the sources are absent and this skips.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lib = (n) => fileURLToPath(new URL(`../lib/${n}`, import.meta.url));
const sources = {
  "timedeck-client.mjs": fileURLToPath(new URL("../../shared/timedeck-client.mjs", import.meta.url)),
  "timer.mjs": fileURLToPath(new URL("../../../../functions/timedeck/shared/timer.mjs", import.meta.url)),
};
for (const [name, src] of Object.entries(sources)) {
  test(`lib/${name} matches its source (run node integrations/timedeck/sync.mjs)`, { skip: !existsSync(src) && "not inside the DocFila repo" }, () => {
    assert.equal(readFileSync(lib(name), "utf8"), readFileSync(src, "utf8"));
  });
}
