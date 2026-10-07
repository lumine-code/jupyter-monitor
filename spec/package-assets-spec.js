const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

describe("monitor package ownership", () => {
  it("keeps the canonical description in its own manifest and README", () => {
    const manifest = require("../package.json");
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    expect(readme.split(/\r?\n/)[2]).toBe(manifest.description);
    expect(readme).not.toContain("repository is retired");
    expect(manifest.specPackages).toContain("jupyter-repl");
    expect(manifest.consumedServices["jupyter.kernel"].versions["^1.0.0"]).toBe(
      "consumeJupyterKernel",
    );
    expect(manifest.consumedServices["jupyter.kernel"].activation).toBeUndefined();
  });

  it("owns its reveal command and keeps table actions local", () => {
    const keymap = JSON.parse(fs.readFileSync(path.join(root, "keymaps/main.json"), "utf8"));
    expect(keymap["lumine-workspace"]).toEqual({ "alt-j m": "jupyter-monitor:toggle-focus" });
    expect(keymap[".jupyter-monitor .monitor-wrapper"].i).toBe("jupyter-monitor:interrupt");
    expect(keymap[".jupyter-monitor .monitor-wrapper"].r).toBe("jupyter-monitor:restart");
    expect(keymap[".jupyter-monitor .monitor-wrapper"].s).toBe("jupyter-monitor:shutdown");
  });
});
