const etch = require("@lumine-code/etch");
const Monitor = require("../lib/monitor");

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
    observeActiveKernel(callback) {
      this.activeCallbacks.push(callback);
      callback(this.active);
      return { dispose() {} };
    },
    setActive(kernel) {
      this.active = kernel;
      this.activeCallbacks.slice().forEach((callback) => callback(kernel));
    },
    activeCallbacks: [],
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

  const rows = () => [...component.element.querySelectorAll(".monitor-row")];

  it("renders one row per running kernel", () => {
    component = new Monitor({
      provider: fakeProvider([fakeKernel("Python 3"), fakeKernel("R")]),
    });
    flush(component);

    expect(rows().length).toBe(2);
    expect(rows()[0].querySelector(".monitor-kernel").textContent).toBe("Python 3");
  });

  it("says nothing is running when nothing is", () => {
    component = new Monitor({ provider: fakeProvider([]) });
    flush(component);

    expect(rows().length).toBe(0);
    // The header stays, so the panel does not look broken.
    expect(component.element.querySelector(".monitor-header")).toBeTruthy();
  });

  it("tints the observed active kernel's row and follows tab switches", () => {
    const python = fakeKernel("Python 3");
    const r = fakeKernel("R");
    const provider = fakeProvider([python, r]);
    component = new Monitor({ provider });
    flush(component);

    expect(rows()[0].classList.contains("current")).toBe(true);

    // What jupyter-repl announces after the user switches to the R file.
    provider.setActive(r);
    flush(component);

    expect(rows()[0].classList.contains("current")).toBe(false);
    expect(rows()[1].classList.contains("current")).toBe(true);

    // A tab no kernel serves tints nothing.
    provider.setActive(null);
    flush(component);
    expect(component.element.querySelectorAll(".monitor-row.current").length).toBe(0);
  });

  it("moves a keyboard cursor independently of the current row", () => {
    const python = fakeKernel("Python 3");
    const r = fakeKernel("R");
    const provider = fakeProvider([python, r]);
    provider.active = python;
    component = new Monitor({ provider });
    flush(component);

    component.move(1);
    flush(component);

    // The tint stays on the active file's kernel; the cursor is its own mark.
    expect(rows()[0].classList.contains("current")).toBe(true);
    expect(rows()[1].classList.contains("focused")).toBe(true);

    // With no cursor and no current row, the first press enters the list.
    provider.setActive(null);
    component.focusedKey = null;
    component.move(1);
    flush(component);
    expect(rows()[0].classList.contains("focused")).toBe(true);
  });

  it("runs an action against the cursor, or the current row without one", () => {
    const python = fakeKernel("Python 3");
    const r = fakeKernel("R");
    const provider = fakeProvider([python, r]);
    provider.active = python;
    component = new Monitor({ provider });
    flush(component);

    // No cursor: the current row is the target.
    component.act((kernel) => (kernel.acted = "current"));
    expect(python.acted).toBe("current");

    // Cursor placed: it wins.
    component.move(1);
    component.act((kernel) => (kernel.acted = "focused"));
    expect(r.acted).toBe("focused");
  });

  it("opens the kernel's files on a row click, links excepted", () => {
    const python = fakeKernel("Python 3");
    const files = new Map([[python, ["/tmp/analysis.py"]]]);
    component = new Monitor({ provider: fakeProvider([python], files) });
    flush(component);

    const opened = [];
    spyOn(atom.workspace, "open").and.callFake((uri) => {
      opened.push(uri);
      return Promise.resolve();
    });

    // A plain cell click jumps to the file.
    rows()[0].querySelector(".monitor-status").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(opened.length).toBe(1);

    // A click on the kernel-name link keeps its own meaning.
    rows()[0].querySelector(".monitor-kernel a").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(opened.length).toBe(1);
  });

  it("redraws when a kernel reports a status change", () => {
    const python = fakeKernel("Python 3");
    component = new Monitor({ provider: fakeProvider([python]) });
    flush(component);
    expect(rows()[0].querySelector(".monitor-status").textContent).toBe("idle");

    python.executionState = "busy";
    python.emitStatus();
    flush(component);

    expect(rows()[0].querySelector(".monitor-status").textContent).toBe("busy");
  });

  it("re-subscribes when the set of kernels changes", () => {
    const python = fakeKernel("Python 3");
    const r = fakeKernel("R");
    const provider = fakeProvider([python]);
    component = new Monitor({ provider });
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
    component = new Monitor({ provider: fakeProvider([python], files) });
    flush(component);

    expect(rows()[0].querySelector(".monitor-files").textContent).toContain(
      "Unsaved Editor 7",
    );
  });

  it("offers a rename only for a remote session", () => {
    const local = fakeKernel("Python 3");
    const remote = fakeKernel("Remote", { gatewayName: "gateway-1" });
    component = new Monitor({ provider: fakeProvider([local, remote]) });
    flush(component);

    expect(rows()[0].querySelector(".icon-pencil")).toBeFalsy();
    expect(rows()[1].querySelector(".icon-pencil")).toBeTruthy();
    expect(rows()[1].querySelector(".monitor-gateway").textContent).toBe("gateway-1");
  });

  it("drops every kernel subscription when destroyed", () => {
    const python = fakeKernel("Python 3");
    component = new Monitor({ provider: fakeProvider([python]) });
    flush(component);
    expect(python.listenerCount()).toBe(1);

    component.destroy();
    component = null;

    expect(python.listenerCount()).toBe(0);
  });
});

describe("kernel monitor pane", () => {
  const MonitorPane = require("../lib/monitor-pane");

  // Losing the kernel service destroys the item directly rather than through
  // `pane.destroyItem`, and a pane only drops an item that tells it so.
  it("leaves no tab behind when destroyed directly", () => {
    const pane = new MonitorPane(fakeProvider([]));
    const workspacePane = atom.workspace.getCenter().getActivePane();
    workspacePane.addItem(pane);

    expect(workspacePane.getItems()).toContain(pane);

    pane.destroy();

    expect(workspacePane.getItems()).not.toContain(pane);
  });

  it("survives being destroyed twice", () => {
    const pane = new MonitorPane(fakeProvider([]));
    pane.destroy();
    expect(() => pane.destroy()).not.toThrow();
  });
});
