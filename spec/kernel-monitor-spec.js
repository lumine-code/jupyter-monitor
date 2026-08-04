const etch = require("@lumine-code/etch");
const KernelMonitor = require("../lib/kernel-monitor");

// This panel used to live inside jupyter-repl and read its store directly. It
// now sees kernels only through the `jupyter.kernel` service, so these specs
// stand in for that provider: anything they need that the contract does not
// offer is a gap in the contract, not something to reach around.

const flush = (component) => etch.updateSync(component);

function fakeKernel(displayName, overrides = {}) {
  const listeners = [];
  return {
    id: `kernel-${displayName}`,
    displayName,
    language: "python",
    executionState: "idle",
    executionCount: 0,
    lastExecutionTime: "No execution",
    kernelSpec: { display_name: displayName },
    interrupt() {
      this.interrupted = true;
    },
    restart() {
      this.restarted = true;
    },
    shutdown() {
      this.shutDown = true;
    },
    onDidChangeStatus(callback) {
      listeners.push(callback);
      return {
        dispose() {
          const index = listeners.indexOf(callback);
          if (index > -1) listeners.splice(index, 1);
        },
      };
    },
    emitStatus() {
      listeners.slice().forEach((callback) => callback());
    },
    listenerCount: () => listeners.length,
    ...overrides,
  };
}

// Only the parts of `jupyter.kernel` this panel consumes.
function fakeProvider(kernels, files = new Map()) {
  const kernelsCallbacks = [];
  return {
    kernels,
    active: kernels[0] || null,
    getRunningKernels() {
      return this.kernels;
    },
    getActiveKernel() {
      return this.active;
    },
    getFilesForKernel: (kernel) => files.get(kernel) || [],
    onDidChangeKernel: () => ({ dispose() {} }),
    onDidChangeKernels(callback) {
      kernelsCallbacks.push(callback);
      return { dispose() {} };
    },
    setKernels(next) {
      this.kernels = next;
      this.active = next[0] || null;
      kernelsCallbacks.slice().forEach((callback) => callback());
    },
  };
}

describe("kernel monitor", () => {
  let component;

  afterEach(() => {
    component?.destroy();
    component = null;
  });

  const rows = () => [...component.element.querySelectorAll(".kernel-monitor-row")];

  it("renders one row per running kernel", () => {
    component = new KernelMonitor({
      provider: fakeProvider([fakeKernel("Python 3"), fakeKernel("R")]),
    });
    flush(component);

    expect(rows().length).toBe(2);
    expect(rows()[0].querySelector(".kernel-monitor-kernel").textContent).toBe("Python 3");
  });

  it("says nothing is running when nothing is", () => {
    component = new KernelMonitor({ provider: fakeProvider([]) });
    flush(component);

    expect(rows().length).toBe(0);
    // The header stays, so the panel does not look broken.
    expect(component.element.querySelector(".kernel-monitor-header")).toBeTruthy();
  });

  it("highlights the provider's active kernel until one is picked by hand", () => {
    const python = fakeKernel("Python 3");
    const r = fakeKernel("R");
    const provider = fakeProvider([python, r]);
    provider.active = r;
    component = new KernelMonitor({ provider });
    flush(component);

    expect(rows()[1].classList.contains("selected")).toBe(true);

    component.move(-1);
    flush(component);

    expect(rows()[0].classList.contains("selected")).toBe(true);
  });

  it("runs an action against the highlighted kernel", () => {
    const python = fakeKernel("Python 3");
    const r = fakeKernel("R");
    component = new KernelMonitor({ provider: fakeProvider([python, r]) });
    flush(component);

    component.move(1);
    component.act((kernel) => kernel.interrupt());

    expect(r.interrupted).toBe(true);
    expect(python.interrupted).toBeUndefined();
  });

  it("redraws when a kernel reports a status change", () => {
    const python = fakeKernel("Python 3");
    component = new KernelMonitor({ provider: fakeProvider([python]) });
    flush(component);
    expect(rows()[0].querySelector(".kernel-monitor-status").textContent).toBe("idle");

    python.executionState = "busy";
    python.emitStatus();
    flush(component);

    expect(rows()[0].querySelector(".kernel-monitor-status").textContent).toBe("busy");
  });

  it("re-subscribes when the set of kernels changes", () => {
    const python = fakeKernel("Python 3");
    const r = fakeKernel("R");
    const provider = fakeProvider([python]);
    component = new KernelMonitor({ provider });
    flush(component);
    expect(python.listenerCount()).toBe(1);

    provider.setKernels([r]);
    flush(component);

    expect(rows().length).toBe(1);
    expect(python.listenerCount()).toBe(0);
    expect(r.listenerCount()).toBe(1);
  });

  it("lists the files a kernel serves", () => {
    const python = fakeKernel("Python 3");
    const files = new Map([[python, ["Unsaved Editor 7"]]]);
    component = new KernelMonitor({ provider: fakeProvider([python], files) });
    flush(component);

    expect(rows()[0].querySelector(".kernel-monitor-files").textContent).toContain(
      "Unsaved Editor 7",
    );
  });

  it("offers a rename only for a remote session", () => {
    const local = fakeKernel("Python 3");
    const remote = fakeKernel("Remote", { gatewayName: "gateway-1" });
    component = new KernelMonitor({ provider: fakeProvider([local, remote]) });
    flush(component);

    expect(rows()[0].querySelector(".icon-pencil")).toBeFalsy();
    expect(rows()[1].querySelector(".icon-pencil")).toBeTruthy();
    expect(rows()[1].querySelector(".kernel-monitor-gateway").textContent).toBe("gateway-1");
  });

  it("drops every kernel subscription when destroyed", () => {
    const python = fakeKernel("Python 3");
    component = new KernelMonitor({ provider: fakeProvider([python]) });
    flush(component);
    expect(python.listenerCount()).toBe(1);

    component.destroy();
    component = null;

    expect(python.listenerCount()).toBe(0);
  });
});
