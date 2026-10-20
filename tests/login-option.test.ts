import { describe, expect, test } from "bun:test";

import { Command } from "commander";

// Mirrors the negatable option on `solti account login` (src/index.ts):
// commander gives `launchBrowser` a `true` default and flips it to `false`
// when `--no-launch-browser` is passed.
function makeLoginCommand(): Command {
  return new Command().option(
    "--no-launch-browser",
    "print the sign-in URL instead of opening a browser",
  );
}

describe("account login --no-launch-browser option", () => {
  test("defaults to launching the browser (launchBrowser is true)", () => {
    const command = makeLoginCommand();
    command.parse(["node", "solti"], { from: "node" });
    expect(command.opts()).toEqual({ launchBrowser: true });
  });

  test("--no-launch-browser sets launchBrowser to false", () => {
    const command = makeLoginCommand();
    command.parse(["node", "solti", "--no-launch-browser"], { from: "node" });
    expect(command.opts()).toEqual({ launchBrowser: false });
  });
});
