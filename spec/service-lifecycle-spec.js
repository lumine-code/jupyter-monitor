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
    expect(pane.destroyed).toBe(true);
  });
});
