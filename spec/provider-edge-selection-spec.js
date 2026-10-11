const { Disposable } = require("lumine");

describe("Monitor surviving provider connections", () => {
  let leases, pane;
  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    spyOn(lumine.clipboard, "write");
    leases = [];
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("jupyter-monitor");
  });
  afterEach(async () => {
    for (const lease of leases) lease.dispose();
    pane?.destroy();
    if (lumine.packages.isPackageLoaded("jupyter-monitor"))
      await lumine.packages.unloadPackage("jupyter-monitor");
    await lumine.fileWatchClient.settlePendingTeardown();
  });
  function provider(name) {
    const kernel = {
      id: "owned-" + name,
      displayName: name,
      executionState: "idle",
      kernelSpec: {},
      interrupt: jasmine.createSpy("interrupt " + name).and.resolveTo(),
    };
    return {
      kernel,
      getRunningKernels: () => [kernel],
      getFilesForKernel: () => [],
      observeActiveKernel(callback) {
        callback(kernel);
        return new Disposable();
      },
      onDidChangeKernels: () => new Disposable(),
    };
  }
  function provide(service) {
    const lease = lumine.packages.serviceHub.provide("jupyter.kernel", "1.0.0", service);
    leases.push(lease);
    return lease;
  }
  async function open() {
    pane = await lumine.workspace.open("lumine://jupyter-monitor", { searchAllPanes: true });
    await flush();
  }
  const flush = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  async function interrupt(service) {
    expect(pane.element.querySelector(".monitor-kernel")?.textContent).toBe(
      service.kernel.displayName,
    );
    await lumine.commands.dispatch(pane.getFocusTarget(), "jupyter-monitor:interrupt");
    expect(service.kernel.interrupt).toHaveBeenCalledTimes(1);
  }
  it("keeps a shared provider's row and command after its newest connection retires", async () => {
    const service = provider("shared");
    provide(service);
    const latest = provide(service);
    await open();
    latest.dispose();
    await flush();
    await interrupt(service);
  });
  it("restores the surviving provider's row and command when its replacement retires", async () => {
    const a = provider("original"),
      b = provider("replacement");
    provide(a);
    const replacement = provide(b);
    await open();
    replacement.dispose();
    await flush();
    await interrupt(a);
    expect(b.kernel.interrupt).not.toHaveBeenCalled();
  });
  it("keeps the ordinary latest live provider as the command target", async () => {
    const a = provider("original"),
      b = provider("replacement");
    const first = provide(a);
    provide(b);
    await open();
    first.dispose();
    await flush();
    await interrupt(b);
    expect(a.kernel.interrupt).not.toHaveBeenCalled();
  });
});
