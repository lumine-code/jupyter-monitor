const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Disposable } = require("lumine");

describe("Kernel monitor file path classification", () => {
  let directory, temporaryRoot, edges, editors;

  beforeEach(async () => {
    jasmine.useRealClock();
    temporaryRoot = fs.realpathSync.native(os.tmpdir());
    directory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(temporaryRoot, "monitor-file-link-")),
    );
    edges = [];
    editors = [];
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("jupyter-monitor");
  });

  afterEach(async () => {
    for (const edge of edges) edge.dispose();
    await lumine.packages.deactivatePackage("jupyter-monitor");
    for (const editor of editors) editor.destroy();
    await lumine.fileWatchClient.settlePendingTeardown();
    const relative = path.relative(temporaryRoot, directory);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new Error("Monitor fixture escaped its temporary root");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function openSaved(relativePath) {
    const filePath = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "print('saved')\n");
    const editor = await lumine.workspace.open(filePath);
    editors.push(editor);
    return editor;
  }

  async function showFiles(filePaths) {
    const kernel = {
      id: "path-classification-kernel",
      displayName: "Path classification",
      kernelSpec: { display_name: "Path classification" },
      executionState: "idle",
      language: "python",
    };
    const provider = {
      getRunningKernels: () => [kernel],
      getFilesForKernel: () => filePaths,
      observeActiveKernel(callback) {
        callback(kernel);
        return new Disposable();
      },
      onDidChangeKernels: () => new Disposable(),
    };
    edges.push(lumine.packages.serviceHub.provide("jupyter.kernel", "1.0.0", provider));
    return lumine.workspace.open("lumine://jupyter-monitor");
  }

  it("opens a saved filename containing the unsaved placeholder from its file link", async () => {
    const editor = await openSaved("Unsaved Editor 12345.py");
    const pane = await showFiles([editor.getPath()]);
    const link = lumine.views.getView(pane).querySelector(".monitor-files a");
    const open = spyOn(lumine.workspace, "open").and.callThrough();
    link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith(editor.getPath(), { searchAllPanes: true });
  });

  it("opens a saved path with a placeholder-shaped directory from the row command", async () => {
    const editor = await openSaved(path.join("Unsaved Editor 12345", "script.py"));
    const pane = await showFiles([editor.getPath()]);
    const open = spyOn(lumine.workspace, "open").and.callThrough();
    await lumine.commands.dispatch(pane.getFocusTarget(), "jupyter-monitor:open-files");
    expect(open).toHaveBeenCalledWith(editor.getPath(), { searchAllPanes: true });
  });

  it("opens the saved file from a click on its kernel row", async () => {
    const editor = await openSaved("prefix Unsaved Editor 12345 suffix.py");
    const pane = await showFiles([editor.getPath()]);
    const row = lumine.views.getView(pane).querySelector(".monitor-row");
    const open = spyOn(lumine.workspace, "open").and.callThrough();
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith(editor.getPath(), { searchAllPanes: true });
  });

  for (const [kind, placeholder] of [
    ["spaces", (id) => `Unsaved Editor ${id}`],
    ["tabs", (id) => `Unsaved\tEditor\t${id}`],
  ]) {
    it(`keeps the existing ${kind} and ID lookup for a complete unsaved placeholder`, async () => {
      const editor = await lumine.workspace.open();
      editors.push(editor);
      const pane = await showFiles([placeholder(editor.id)]);
      const link = lumine.views.getView(pane).querySelector(".monitor-files a");
      const open = spyOn(lumine.workspace, "open").and.callThrough();
      link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      expect(open).toHaveBeenCalledWith(editor, { searchAllPanes: true });
    });
  }
});
