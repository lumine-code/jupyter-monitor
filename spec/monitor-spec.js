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
  const names = () => rows().map((row) => row.querySelector(".monitor-kernel").textContent);
  const headers = () => [...component.element.querySelectorAll(".monitor-header th")];
  const sort = (column) => {
    headers()[column].querySelector("button").click();
    flush(component);
  };

  it("renders one row per running kernel", () => {
    component = new Monitor({
      provider: fakeProvider([fakeKernel("Python 3"), fakeKernel("R")]),
    });
    flush(component);

    expect(rows().length).toBe(2);
    expect(rows()[0].querySelector(".monitor-kernel").textContent).toBe("Python 3");
    expect(headers().map((header) => header.textContent)).toEqual([
      "Gateway",
      "Kernel",
      "Status",
      "Count",
      "Last Exec Time",
      "Files",
    ]);
    expect(component.element.querySelector(".monitor-managements")).toBeNull();
  });

  it("signals accepted Enter and open-files once even when the monitor has not scrolled", () => {
    const kernel = fakeKernel("Python");
    component = new Monitor({ provider: fakeProvider([kernel]) });
    flush(component);
    jasmine.attachToDOM(component.element);
    component.move(1);
    flush(component);
    const open = spyOn(component, "openFilesFor");
    const reveal = spyOn(lumine.scrollbars, "reveal");
    const before = component.element.scrollTop;
    lumine.commands.dispatch(component.element, "core:confirm");
    expect(open).toHaveBeenCalledOnceWith(kernel);
    expect(reveal).toHaveBeenCalledOnceWith(component.element);
    expect(component.element.scrollTop).toBe(before);
    reveal.calls.reset();
    lumine.commands.dispatch(component.element, "core:confirm");
    expect(reveal).not.toHaveBeenCalled();
    lumine.commands.dispatch(component.element, "jupyter-monitor:open-files");
    expect(reveal).toHaveBeenCalledOnceWith(component.element);
  });

  it("keeps native button confirmation and kernel data actions outside navigation activity", () => {
    const kernel = fakeKernel("Python");
    component = new Monitor({ provider: fakeProvider([kernel]) });
    flush(component);
    jasmine.attachToDOM(component.element);
    component.move(1);
    flush(component);
    const reveal = spyOn(lumine.scrollbars, "reveal");
    const open = spyOn(component, "openFilesFor");
    lumine.commands.dispatch(headers()[1].querySelector("button"), "core:confirm");
    lumine.commands.dispatch(component.element, "jupyter-monitor:interrupt");
    expect(kernel.interrupted).toBeTrue();
    expect(open).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });

  it("says nothing is running when nothing is", () => {
    component = new Monitor({ provider: fakeProvider([]) });
    flush(component);

    expect(rows().length).toBe(0);
    // The header stays, so the panel does not look broken.
    expect(component.element.querySelector(".monitor-header")).toBeTruthy();
    expect(component.element.querySelector(".panel-empty-state li").textContent).toBe(
      "No running kernels",
    );
    expect(component.element.querySelector("table .panel-empty-state")).toBeNull();
  });

  it("updates the empty body when the provider starts and removes kernels", () => {
    const provider = fakeProvider([]);
    component = new Monitor({ provider });
    flush(component);
    const header = component.element.querySelector("thead");
    expect(component.element.querySelector(".panel-empty-state")).not.toBeNull();

    provider.setKernels([fakeKernel("Python 3")]);
    flush(component);
    expect(rows().length).toBe(1);
    expect(component.element.querySelector(".panel-empty-state")).toBeNull();

    provider.setKernels([]);
    flush(component);
    expect(rows().length).toBe(0);
    expect(component.element.querySelector(".panel-empty-state li").textContent).toBe(
      "No running kernels",
    );
    expect(component.element.querySelector("thead")).toBe(header);
    sort(1);
    expect(headers()[1].getAttribute("aria-sort")).toBe("ascending");
  });

  it("keeps provider order until a sortable column is chosen and exposes its direction", () => {
    component = new Monitor({
      provider: fakeProvider([
        fakeKernel("Kernel 10"),
        fakeKernel("Kernel 2"),
        fakeKernel("Kernel 1"),
      ]),
    });
    flush(component);
    expect(names()).toEqual(["Kernel 10", "Kernel 2", "Kernel 1"]);
    expect(headers().filter((header) => header.getAttribute("aria-sort") === "none").length).toBe(
      6,
    );
    expect(headers().every((header) => header.scope === "col")).toBeTrue();
    expect(headers()[5].querySelector("button")).not.toBeNull();

    sort(1);
    expect(names()).toEqual(["Kernel 1", "Kernel 2", "Kernel 10"]);
    expect(headers()[1].getAttribute("aria-sort")).toBe("ascending");
    sort(1);
    expect(names()).toEqual(["Kernel 10", "Kernel 2", "Kernel 1"]);
    expect(headers()[1].getAttribute("aria-sort")).toBe("descending");
    sort(0);
    expect(headers()[0].getAttribute("aria-sort")).toBe("ascending");
    expect(headers()[1].getAttribute("aria-sort")).toBe("none");
  });

  it("sorts counts numerically without changing provider order or reversing equal values", () => {
    const kernels = Object.freeze([
      fakeKernel("A", { executionCount: 10 }),
      fakeKernel("B", { executionCount: 2 }),
      fakeKernel("C", { executionCount: 2 }),
      fakeKernel("D", { executionCount: 20 }),
    ]);
    const provider = fakeProvider(kernels);
    component = new Monitor({ provider });
    flush(component);

    sort(3);
    expect(names()).toEqual(["B", "C", "A", "D"]);
    sort(3);
    expect(names()).toEqual(["D", "A", "B", "C"]);
    expect(provider.kernels).toEqual(kernels);
    expect(provider.kernels.map((kernel) => kernel.displayName)).toEqual(["A", "B", "C", "D"]);
  });

  it("compares elapsed times across units and leaves unavailable times last in both directions", () => {
    component = new Monitor({
      provider: fakeProvider([
        fakeKernel("Ten seconds", { lastExecutionTime: "10.000 sec" }),
        fakeKernel("One hour", { lastExecutionTime: "1 h 0 m 0 s" }),
        fakeKernel("Not run"),
        fakeKernel("One minute", { lastExecutionTime: "1 min 0 sec" }),
        fakeKernel("Two seconds", { lastExecutionTime: "2.000 sec" }),
        fakeKernel("Unavailable", { lastExecutionTime: "Not available" }),
        fakeKernel("Zero", { lastExecutionTime: "0.000 sec" }),
      ]),
    });
    flush(component);

    sort(4);
    expect(names()).toEqual([
      "Zero",
      "Two seconds",
      "Ten seconds",
      "One minute",
      "One hour",
      "Not run",
      "Unavailable",
    ]);
    sort(4);
    expect(names()).toEqual([
      "One hour",
      "One minute",
      "Ten seconds",
      "Two seconds",
      "Zero",
      "Not run",
      "Unavailable",
    ]);
  });

  it("sorts gateway names, visible connection status and served files", () => {
    const a = fakeKernel("A", { gatewayName: "Remote 10", executionState: "busy" });
    const b = fakeKernel("B", { gatewayName: "Remote 2", connectionState: "recovering" });
    const c = fakeKernel("C");
    component = new Monitor({
      provider: fakeProvider(
        [a, b, c],
        new Map([
          [a, ["/tmp/z.py"]],
          [b, ["/tmp/a.py"]],
        ]),
      ),
    });
    flush(component);

    sort(0);
    expect(names()).toEqual(["C", "B", "A"]);
    sort(2);
    expect(names()).toEqual(["A", "C", "B"]);
    sort(5);
    expect(names()).toEqual(["B", "A", "C"]);
    sort(5);
    expect(names()).toEqual(["A", "B", "C"]);
  });

  it("keeps current and focused kernel identities while navigation follows the sorted rows", () => {
    const a = fakeKernel("A", { executionCount: 3 });
    const b = fakeKernel("B", { executionCount: 1 });
    const c = fakeKernel("C", { executionCount: 2 });
    component = new Monitor({ provider: fakeProvider([a, b, c]) });
    component.move(1);
    flush(component);
    expect(component.focusedKernel()).toBe(b);

    sort(3);
    expect(names()).toEqual(["B", "C", "A"]);
    expect(rows()[0].classList.contains("focused")).toBeTrue();
    expect(rows()[2].classList.contains("current")).toBeTrue();
    component.move(1);
    flush(component);
    expect(component.focusedKernel()).toBe(c);

    a.executionCount = 0;
    a.emitStatus();
    flush(component);
    expect(names()).toEqual(["A", "B", "C"]);
    expect(rows()[0].classList.contains("current")).toBeTrue();
    expect(rows()[2].classList.contains("focused")).toBeTrue();
  });

  it("leaves native header confirmation to its own button", async () => {
    const python = fakeKernel("Python 3");
    const r = fakeKernel("R");
    component = new Monitor({
      provider: fakeProvider([python, r], new Map([[r, ["/tmp/report.R"]]])),
    });
    flush(component);
    jasmine.attachToDOM(component.element);
    component.move(1);
    flush(component);
    spyOn(lumine.workspace, "open").and.returnValue(Promise.resolve());
    const header = headers()[1].querySelector("button");
    header.focus();
    await lumine.commands.dispatch(header, "core:confirm");
    expect(lumine.workspace.open).not.toHaveBeenCalled();
    header.click();
    flush(component);
    expect(document.activeElement).toBe(header);
    expect(header.classList.contains("native-key-bindings")).toBeTrue();
    expect(headers()[1].getAttribute("aria-sort")).toBe("ascending");
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

    // The first press offsets from the current row: down from the tinted
    // kernel reaches its neighbour. The tint stays put: the cursor is its
    // own mark.
    component.move(1);
    flush(component);
    expect(rows()[0].classList.contains("current")).toBe(true);
    expect(rows()[1].classList.contains("focused")).toBe(true);

    component.move(-1);
    flush(component);
    expect(rows()[0].classList.contains("focused")).toBe(true);

    // With no cursor and no current row, the list is entered from the end
    // the key came from.
    provider.setActive(null);
    component.focusedKey = null;
    component.move(-1);
    flush(component);
    expect(rows()[1].classList.contains("focused")).toBe(true);
  });

  it("steps off a mid-list current row in both directions", () => {
    const a = fakeKernel("A");
    const b = fakeKernel("B");
    const c = fakeKernel("C");
    const provider = fakeProvider([a, b, c]);
    provider.active = c;
    component = new Monitor({ provider });
    flush(component);
    provider.setActive(b);
    flush(component);
    expect(rows()[1].classList.contains("current")).toBe(true);

    // Current is the middle row: up reaches the row above it.
    component.move(-1);
    flush(component);
    expect(rows()[0].classList.contains("focused")).toBe(true);

    // And afresh, down reaches the row below it.
    component.focusedKey = null;
    component.move(1);
    flush(component);
    expect(rows()[2].classList.contains("focused")).toBe(true);
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

    // Cursor placed and moved off the current row: it wins.
    component.move(1);
    component.move(1);
    component.act((kernel) => (kernel.acted = "focused"));
    expect(r.acted).toBe("focused");
  });

  it("opens the kernel's files on a row click while the kernel name stays plain", () => {
    const python = fakeKernel("Python 3");
    const files = new Map([[python, ["/tmp/analysis.py"]]]);
    component = new Monitor({ provider: fakeProvider([python], files) });
    flush(component);

    const opened = [];
    spyOn(lumine.workspace, "open").and.callFake((uri) => {
      opened.push(uri);
      return Promise.resolve();
    });
    spyOn(lumine.notifications, "addInfo");

    // A plain cell click jumps to the file.
    rows()[0]
      .querySelector(".monitor-status")
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(opened.length).toBe(1);

    const name = rows()[0].querySelector(".monitor-kernel");
    expect(name.textContent).toBe("Python 3");
    expect(name.querySelector("a, button")).toBeNull();
    expect(name.hasAttribute("title")).toBeFalse();
    expect(rows()[0].querySelector(".monitor-files a").hasAttribute("title")).toBeFalse();
    name.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(opened.length).toBe(1);
    expect(lumine.notifications.addInfo).not.toHaveBeenCalled();
  });

  it("drops the cursor on confirm and on leaving the panel", () => {
    const python = fakeKernel("Python 3");
    const r = fakeKernel("R");
    const provider = fakeProvider(
      [python, r],
      new Map([
        [python, ["/tmp/analysis.py"]],
        [r, ["/tmp/report.R"]],
      ]),
    );
    provider.active = python;
    component = new Monitor({ provider });
    flush(component);
    spyOn(lumine.workspace, "open").and.returnValue(Promise.resolve());

    component.move(1);
    flush(component);
    expect(component.element.querySelectorAll(".monitor-row.focused").length).toBe(1);

    // Enter: the journey ends, the cursor goes with it.
    component.confirmFocused();
    flush(component);
    expect(component.element.querySelectorAll(".monitor-row.focused").length).toBe(0);
    expect(lumine.workspace.open).toHaveBeenCalled();

    // Enter with no cursor does nothing.
    lumine.workspace.open.calls.reset();
    component.confirmFocused();
    expect(lumine.workspace.open).not.toHaveBeenCalled();

    // And leaving the panel clears it too.
    component.move(1);
    flush(component);
    component.element.dispatchEvent(new FocusEvent("focusout", { relatedTarget: null }));
    flush(component);
    expect(component.element.querySelectorAll(".monitor-row.focused").length).toBe(0);
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

  it("retains status subscriptions when only a file mapping changes", () => {
    const python = fakeKernel("Python 3");
    spyOn(python, "onDidChangeStatus").and.callThrough();
    const provider = fakeProvider([python]);
    component = new Monitor({ provider });
    flush(component);
    provider.setKernels([python]);
    flush(component);
    expect(python.onDidChangeStatus).toHaveBeenCalledTimes(1);
    expect(python.listenerCount()).toBe(1);
  });

  it("reports an asynchronous restart failure from the row command", async () => {
    const python = fakeKernel("Python 3", {
      restart: () => Promise.reject(new Error("Kernel exited")),
    });
    component = new Monitor({ provider: fakeProvider([python]) });
    flush(component);
    spyOn(lumine.notifications, "addError");
    await lumine.commands.dispatch(rows()[0], "jupyter-monitor:restart");
    await Promise.resolve();
    expect(lumine.notifications.addError).toHaveBeenCalledWith("Jupyter kernel command failed", {
      detail: "Kernel exited",
      dismissable: true,
    });
  });

  it("reports a revoked wrapper's synchronous command failure", async () => {
    const python = fakeKernel("Python 3", {
      interrupt: () => {
        throw new Error("Kernel destroyed");
      },
    });
    component = new Monitor({ provider: fakeProvider([python]) });
    flush(component);
    spyOn(lumine.notifications, "addError");
    await lumine.commands.dispatch(component.element, "jupyter-monitor:interrupt");
    expect(lumine.notifications.addError).toHaveBeenCalledWith("Jupyter kernel command failed", {
      detail: "Kernel destroyed",
      dismissable: true,
    });
  });

  it("lists the files a kernel serves", () => {
    const python = fakeKernel("Python 3");
    const files = new Map([[python, ["Unsaved Editor 7"]]]);
    component = new Monitor({ provider: fakeProvider([python], files) });
    flush(component);

    expect(rows()[0].querySelector(".monitor-files").textContent).toContain("Unsaved Editor 7");
  });

  it("offers a rename only for a session with the public capability", async () => {
    const local = fakeKernel("Python 3");
    const remote = fakeKernel("Remote", {
      gatewayName: "gateway-1",
      capabilities: { rename: true },
      rename() {},
    });
    component = new Monitor({ provider: fakeProvider([local, remote]) });
    flush(component);

    expect(lumine.commands.canDispatch(rows()[0], "jupyter-monitor:rename-session")).toBeFalse();
    expect(lumine.commands.canDispatch(rows()[1], "jupyter-monitor:rename-session")).toBeTrue();
    const rename = spyOn(component, "promptRename");
    await lumine.commands.dispatch(rows()[0], "jupyter-monitor:rename-session");
    expect(rename).not.toHaveBeenCalled();
    await lumine.commands.dispatch(rows()[1], "jupyter-monitor:rename-session");
    expect(rename).toHaveBeenCalledOnceWith(remote);
    remote.capabilities.rename = false;
    remote.emitStatus();
    flush(component);
    expect(lumine.commands.canDispatch(rows()[1], "jupyter-monitor:rename-session")).toBeFalse();
    expect(rows()[1].querySelector(".monitor-gateway").textContent).toBe("gateway-1");
  });

  describe("row context commands", () => {
    let menu;
    let host;

    beforeEach(() => {
      menu = lumine.contextMenu.add(require("../menus/main.json")["context-menu"]);
      host = document.createElement("div");
      host.className = "jupyter-monitor";
      jasmine.attachToDOM(host);
    });

    afterEach(() => {
      menu.dispose();
      host.remove();
    });

    const attach = (provider) => {
      component = new Monitor({ provider });
      host.append(component.element);
      flush(component);
    };

    it("runs the clicked row's actions while another kernel is current and focused", async () => {
      const current = fakeKernel("Current");
      const focused = fakeKernel("Focused");
      const clicked = fakeKernel("Clicked", { capabilities: { rename: true }, rename() {} });
      attach(fakeProvider([current, focused, clicked]));
      component.move(1);
      flush(component);
      const target = rows()[2].querySelector(".monitor-kernel");
      const template = lumine.contextMenu.templateForEvent({ target });
      const commands = template.map((item) => item.command).filter(Boolean);
      expect(commands).toEqual([
        "jupyter-monitor:open-files",
        "jupyter-monitor:show-kernel-spec",
        "jupyter-monitor:interrupt",
        "jupyter-monitor:restart",
        "jupyter-monitor:rename-session",
        "jupyter-monitor:shutdown",
      ]);
      spyOn(lumine.notifications, "addInfo");
      await lumine.commands.dispatch(target, "jupyter-monitor:show-kernel-spec");
      expect(lumine.notifications.addInfo).toHaveBeenCalledOnceWith("Kernel Spec", {
        detail: JSON.stringify(clicked.kernelSpec, null, 2),
        dismissable: true,
      });
      const rename = spyOn(component, "promptRename");
      for (const action of ["interrupt", "restart", "shutdown"]) {
        spyOn(current, action);
        spyOn(focused, action);
        spyOn(clicked, action);
        await lumine.commands.dispatch(target, `jupyter-monitor:${action}`);
        expect(clicked[action]).toHaveBeenCalledTimes(1);
        expect(current[action]).not.toHaveBeenCalled();
        expect(focused[action]).not.toHaveBeenCalled();
      }
      await lumine.commands.dispatch(target, "jupyter-monitor:rename-session");
      expect(rename).toHaveBeenCalledOnceWith(clicked);
      expect(component.focusedKernel()).toBe(focused);
      expect(component.currentKernel()).toBe(current);
    });

    it("never retargets an old row to the current kernel or a replacement with the same id", async () => {
      const current = fakeKernel("Current");
      const removed = fakeKernel("Removed");
      const provider = fakeProvider([current, removed]);
      attach(provider);
      const oldRow = rows()[1];
      const target = oldRow.querySelector(".monitor-status");
      const replacement = fakeKernel("Replacement", { id: removed.id });
      spyOn(current, "interrupt");
      spyOn(removed, "interrupt");
      spyOn(replacement, "interrupt");
      provider.setKernels([current, replacement]);
      flush(component);

      expect(rows()[1]).not.toBe(oldRow);
      expect(component.kernelForEvent({ target })).toBeNull();
      expect(lumine.commands.canDispatch(target, "jupyter-monitor:interrupt")).toBeFalse();
      await lumine.commands.dispatch(target, "jupyter-monitor:interrupt");
      component.act((kernel) => kernel.interrupt(), { target });
      expect(current.interrupt).not.toHaveBeenCalled();
      expect(removed.interrupt).not.toHaveBeenCalled();
      expect(replacement.interrupt).not.toHaveBeenCalled();

      await lumine.commands.dispatch(rows()[1], "jupyter-monitor:interrupt");
      expect(replacement.interrupt).toHaveBeenCalledTimes(1);
    });
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
    const workspacePane = lumine.workspace.getBottomDock().getActivePane();
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
