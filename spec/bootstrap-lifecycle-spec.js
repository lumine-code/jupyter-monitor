const path = require("node:path");

describe("monitor restoration before the real runtime bootstrap", () => {
  let pack, monitor, editor, kernel, subscription;
  beforeEach(async () => {
    for (const name of ["jupyter-monitor", "jupyter-repl"]) {
      if (lumine.packages.isPackageLoaded(name)) await lumine.packages.unloadPackage(name);
    }
    pack = lumine.packages.loadPackage(path.resolve(__dirname, ".."));
  });
  afterEach(async () => {
    subscription?.dispose();
    kernel?.destroy();
    editor?.destroy();
    for (const name of ["jupyter-monitor", "jupyter-repl"]) {
      if (lumine.packages.isPackageLoaded(name)) await lumine.packages.unloadPackage(name);
    }
    await lumine.fileWatchClient.settlePendingTeardown();
  });

  it("restores its own inert pane through the manifest and follows the runtime after activation", async () => {
    const initialPackages = spyOn(lumine.packages, "hasActivatedInitialPackages").and.returnValue(
      false,
    );
    monitor = lumine.deserializers.deserialize({ deserializer: "jupyter-monitor/MonitorPane" });
    expect(monitor).toBeTruthy();
    expect(pack.mainInitialized).toBe(true);
    expect(pack.mainActivated).toBe(false);
    expect(monitor.component.provider.getRunningKernels()).toEqual([]);
    expect(monitor.serialize()).toEqual({ deserializer: "jupyter-monitor/MonitorPane" });
    initialPackages.and.callThrough();
    await lumine.packages.activatePackage(pack.name);
    const runtime = await lumine.packages.activatePackage("jupyter-repl");
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    const provider = runtime.mainModule.provideJupyterKernel();
    expect(monitor.component.provider).toBe(provider);
    const seen = [];
    subscription = provider.onDidChangeKernel((value) => seen.push(value));
    editor = await lumine.workspace.open();
    const packageRoot = lumine.packages.getLoadedPackage("jupyter-repl").path;
    const KernelTransport = require(path.join(packageRoot, "lib/kernel-transport"));
    const Kernel = require(path.join(packageRoot, "lib/kernel"));
    const transport = new KernelTransport(
      { display_name: "Restored session", language: "python" },
      editor.getGrammar(),
    );
    transport.setLifecycle("ready");
    transport.setExecutionState("idle");
    kernel = new Kernel(transport);
    const store = require(path.join(packageRoot, "lib/store"));
    store.newKernel(kernel, `Unsaved Editor ${editor.id}`, editor, editor.getGrammar());
    store.updateEditor(editor);
    store.updateActivePaneItem(editor);
    expect(seen.at(-1)).toBe(kernel.getPluginWrapper());
    expect(provider.getActiveKernel()).toBe(kernel.getPluginWrapper());
    expect(monitor.component.provider.getRunningKernels()).toContain(kernel.getPluginWrapper());
  });
});
