const { Disposable } = require("lumine");

describe("monitor provider replacement", () => {
  let main;
  beforeEach(() => {
    main = require("../lib/main");
    main.initialize();
    main.activate();
  });
  afterEach(() => main.deactivate());

  function provider() {
    return {
      getRunningKernels: () => [],
      getFilesForKernel: () => [],
      observeActiveKernel(callback) {
        callback(null);
        return new Disposable();
      },
      onDidChangeKernels: () => new Disposable(),
    };
  }

  it("keeps the pane bound to a newer provider when the old one detaches", () => {
    const pane = main.deserializeMonitorPane();
    const original = main.consumeJupyterKernel(provider());
    const replacementProvider = provider();
    const replacement = main.consumeJupyterKernel(replacementProvider);
    original.dispose();
    expect(pane.destroyed).not.toBe(true);
    expect(pane.component.provider).toBe(replacementProvider);
    replacement.dispose();
    expect(pane.destroyed).not.toBe(true);
    expect(pane.component.provider.getRunningKernels()).toEqual([]);
  });

  it("keeps a same-object replacement edge until that edge is disposed", () => {
    const current = provider();
    const pane = main.deserializeMonitorPane();
    const old = main.consumeJupyterKernel(current);
    const replacement = main.consumeJupyterKernel(current);
    old.dispose();
    expect(pane.component.provider).toBe(current);
    replacement.dispose();
    expect(pane.destroyed).not.toBe(true);
    expect(pane.component.provider.getRunningKernels()).toEqual([]);
  });

  it("keeps consumption passive and requests the runtime only from a user action", async () => {
    const request = spyOn(lumine.packages, "requestService").and.resolveTo(true);
    const edge = main.consumeJupyterKernel(provider());
    expect(request).not.toHaveBeenCalled();
    edge.dispose();
    await main.toggleFocus();
    expect(request).toHaveBeenCalledWith("jupyter.kernel", "^1.0.0");
  });

  it("does not create UI after deactivation while availability was pending", async () => {
    let ready;
    spyOn(lumine.packages, "requestService").and.returnValue(
      new Promise((resolve) => {
        ready = resolve;
      }),
    );
    const open = spyOn(lumine.workspace, "open");
    const pending = main.toggleFocus();
    main.deactivate();
    ready(true);
    await pending;
    expect(open).not.toHaveBeenCalled();
  });
});
