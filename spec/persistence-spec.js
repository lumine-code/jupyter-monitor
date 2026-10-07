const path = require("path");
const etch = require("@lumine-code/etch");
const manifest = require("../package.json");
let main;
const { MONITOR_URI } = require("../lib/utils");
let MonitorPane;

const DESERIALIZER = "jupyter-monitor/MonitorPane";
const STATE = { deserializer: DESERIALIZER };

function fakeProvider() {
  const kernel = {
    id: "kernel-python",
    displayName: "Python 3",
    executionState: "idle",
    executionCount: 0,
    kernelSpec: {},
    onDidChangeStatus: () => ({ dispose() {} }),
  };
  return {
    kernel,
    getRunningKernels: () => [kernel],
    getFilesForKernel: () => [],
    observeActiveKernel(callback) {
      callback(kernel);
      return { dispose() {} };
    },
    onDidChangeKernels: () => ({ dispose() {} }),
  };
}

describe("jupyter monitor pane persistence", () => {
  let loadedPackage = null;
  beforeEach(async () => {
    if (lumine.packages.isPackageLoaded("jupyter-monitor"))
      await lumine.packages.unloadPackage("jupyter-monitor");
    main = require("../lib/main");
    MonitorPane = require("../lib/monitor-pane");
  });

  afterEach(async () => {
    if (loadedPackage && lumine.packages.isPackageActive(loadedPackage.name)) {
      await lumine.packages.deactivatePackage(loadedPackage.name);
    } else {
      main.deactivate();
    }
    if (loadedPackage && lumine.packages.isPackageLoaded(loadedPackage.name)) {
      await lumine.packages.unloadPackage(loadedPackage.name);
    }
    loadedPackage = null;
  });

  it("declares the namespaced deserializer and serializes only its identity", () => {
    expect(manifest.deserializers).toEqual({
      [DESERIALIZER]: "deserializeMonitorPane",
    });

    main.initialize();
    const restored = main.deserializeMonitorPane();

    expect(restored.serialize()).toEqual(STATE);
    expect(restored.getDefaultLocation()).toBe("bottom");
    expect(restored.getAllowedLocations()).toEqual(["bottom"]);
  });

  it("round-trips through the manifest-registered proxy before activation", () => {
    const source = new MonitorPane();
    const state = source.serialize();
    source.destroy();

    spyOn(lumine.packages, "hasActivatedInitialPackages").and.returnValue(false);
    loadedPackage = lumine.packages.loadPackage(path.resolve(__dirname, ".."));

    const restored = lumine.deserializers.deserialize(state);

    expect(restored).toBeTruthy();
    expect(restored.serialize()).toEqual(state);
    expect(lumine.deserializers.deserialize(restored.serialize())).toBe(restored);
    expect(loadedPackage.mainInitialized).toBe(true);
    expect(loadedPackage.mainActivated).toBe(false);
  });

  it("keeps the restored singleton through activation and recreates it after close", async () => {
    main.initialize();
    const restored = main.deserializeMonitorPane();

    main.activate();
    const opened = await lumine.workspace.open(MONITOR_URI, { searchAllPanes: true });

    expect(opened).toBe(restored);
    expect(
      lumine.workspace.getPaneItems().filter((item) => item.getURI?.() === MONITOR_URI).length,
    ).toBe(1);

    restored.destroy();
    const reopened = main.deserializeMonitorPane();
    expect(reopened).not.toBe(restored);
  });

  it("restores an empty shell synchronously and swaps in a late provider", async () => {
    main.initialize();
    const restored = main.deserializeMonitorPane();
    const emptyComponent = restored.component;
    etch.updateSync(emptyComponent);

    expect(emptyComponent.element.querySelectorAll(".monitor-row").length).toBe(0);

    main.activate();
    expect(await lumine.workspace.open(MONITOR_URI, { searchAllPanes: true })).toBe(restored);
    const provider = fakeProvider();
    const service = main.consumeJupyterKernel(provider);
    etch.updateSync(restored.component);

    expect(restored.component).not.toBe(emptyComponent);
    expect(restored.component.provider).toBe(provider);
    expect(restored.component.element.querySelectorAll(".monitor-row").length).toBe(1);

    service.dispose();
    expect(restored.destroyed).not.toBe(true);
    expect(lumine.workspace.getPaneItems()).toContain(restored);
    expect(restored.component.provider.getRunningKernels()).toEqual([]);
  });

  it("opens a real empty table while a provider is unavailable", async () => {
    main.activate();
    const opened = await lumine.workspace.open(MONITOR_URI, { searchAllPanes: true });
    expect(opened).toBeTruthy();
    expect(opened.serialize()).toEqual(STATE);
    expect(opened.component.provider.getRunningKernels()).toEqual([]);
  });
});
