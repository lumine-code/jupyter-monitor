const { Disposable, Emitter } = require("lumine");
const etch = require("@lumine-code/etch");

function fakeKernel(name, overrides = {}) {
  return {
    id: `kernel-${name}`,
    displayName: name,
    executionState: "idle",
    kernelSpec: { display_name: name },
    isDestroyed: () => false,
    shutdown: jasmine.createSpy(`shutdown ${name}`).and.resolveTo(),
    ...overrides,
  };
}

function fakeProvider(kernels, files = new Map()) {
  const events = new Emitter();
  return {
    kernels,
    getRunningKernels() {
      return this.kernels;
    },
    getFilesForKernel: (kernel) => files.get(kernel) || [],
    observeActiveKernel(callback) {
      callback(this.kernels[0] || null);
      return new Disposable();
    },
    onDidChangeKernels: (callback) => events.on("kernels", callback),
    setKernels(next) {
      this.kernels = next;
      events.emit("kernels");
    },
    dispose: () => events.dispose(),
  };
}

function mouse(target, type, button = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button });
  target.dispatchEvent(event);
  return event;
}

describe("kernel monitor shutdown interactions", () => {
  let component, provider;

  const flush = () => etch.updateSync(component);
  const rows = () => [...component.element.querySelectorAll(".monitor-row")];
  const shutdownAllButton = () => component.element.querySelector(".monitor-shutdown-all");
  const attach = (kernels, files) => {
    provider = fakeProvider(kernels, files);
    const Monitor = require("../lib/monitor");
    component = new Monitor({ provider });
    jasmine.attachToDOM(component.element);
    flush();
  };

  afterEach(async () => {
    await component?.destroy();
    provider?.dispose();
    component = null;
    provider = null;
  });

  it("shuts down the middle-clicked row on release regardless of current row, focus or sorting", () => {
    const current = fakeKernel("Current");
    const focused = fakeKernel("Focused");
    const clicked = fakeKernel("Clicked");
    attach([current, focused, clicked], new Map([[clicked, ["/tmp/clicked.py"]]]));
    component.move(1);
    component.sortBy("kernel");
    flush();
    expect(component.currentKernel()).toBe(current);
    expect(component.focusedKernel()).toBe(focused);
    const link = rows()[0].querySelector(".monitor-files a");
    spyOn(lumine.workspace, "open").and.resolveTo();

    expect(mouse(link, "mousedown").defaultPrevented).toBeTrue();
    expect(clicked.shutdown).not.toHaveBeenCalled();
    mouse(link, "mouseup");
    expect(clicked.shutdown).toHaveBeenCalledOnceWith();
    expect(current.shutdown).not.toHaveBeenCalled();
    expect(focused.shutdown).not.toHaveBeenCalled();
    expect(mouse(link, "auxclick").defaultPrevented).toBeTrue();
    expect(clicked.shutdown).toHaveBeenCalledTimes(1);
    expect(lumine.workspace.open).not.toHaveBeenCalled();
    expect(component.currentKernel()).toBe(current);
    expect(component.focusedKernel()).toBe(focused);
  });

  it("ignores other mouse buttons and middle clicks outside a kernel row", () => {
    const kernel = fakeKernel("Python");
    attach([kernel]);
    const cell = rows()[0].querySelector(".monitor-status");
    for (const button of [0, 2]) {
      mouse(cell, "mousedown", button);
      mouse(cell, "mouseup", button);
      mouse(cell, "auxclick", button);
    }
    for (const target of [component.element, component.element.querySelector("thead")]) {
      mouse(target, "mousedown");
      mouse(target, "mouseup");
      mouse(target, "auxclick");
    }
    expect(kernel.shutdown).not.toHaveBeenCalled();
  });

  it("does not retarget a removed row to a replacement with the same id", () => {
    const current = fakeKernel("Current");
    const removed = fakeKernel("Removed");
    attach([current, removed]);
    const oldCell = rows()[1].querySelector(".monitor-status");
    mouse(oldCell, "mousedown");
    const replacement = fakeKernel("Replacement", { id: removed.id });
    provider.setKernels([current, replacement]);
    flush();

    mouse(oldCell, "mouseup");
    mouse(oldCell, "auxclick");
    expect(current.shutdown).not.toHaveBeenCalled();
    expect(removed.shutdown).not.toHaveBeenCalled();
    expect(replacement.shutdown).not.toHaveBeenCalled();

    mouse(rows()[1].querySelector(".monitor-status"), "mouseup");
    expect(replacement.shutdown).toHaveBeenCalledOnceWith();
  });

  it("rechecks provider ownership and destruction before shutting down a visible row", () => {
    const current = fakeKernel("Current");
    const stale = fakeKernel("Stale");
    const destroyed = fakeKernel("Destroyed", { isDestroyed: () => true });
    const unsupported = fakeKernel("Unsupported", { shutdown: null });
    attach([current, stale, destroyed, unsupported]);
    const staleCell = rows()[1].querySelector(".monitor-status");
    provider.kernels = [current, destroyed, unsupported];

    mouse(staleCell, "mouseup");
    mouse(rows()[2].querySelector(".monitor-status"), "mouseup");
    expect(() => mouse(rows()[3].querySelector(".monitor-status"), "mouseup")).not.toThrow();
    expect(current.shutdown).not.toHaveBeenCalled();
    expect(stale.shutdown).not.toHaveBeenCalled();
    expect(destroyed.shutdown).not.toHaveBeenCalled();
  });

  it("keeps Files sorting beside an accessible native shutdown-all header action", () => {
    const kernel = fakeKernel("Python");
    attach([kernel]);
    const header = component.element.querySelector(".monitor-header th:last-child");
    const button = shutdownAllButton();
    expect(header.contains(button)).toBeTrue();
    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Shutdown all");
    expect(button.classList.contains("data-table-header-action")).toBeTrue();
    expect(button.classList.contains("native-key-bindings")).toBeTrue();
    expect(button.matches(".icon-x") || Boolean(button.querySelector(".icon-x"))).toBeTrue();

    header.querySelector(".data-table-sort").click();
    flush();
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(kernel.shutdown).not.toHaveBeenCalled();
    button.click();
    expect(kernel.shutdown).toHaveBeenCalledOnceWith();
    expect(header.getAttribute("aria-sort")).toBe("ascending");
  });

  it("enables shutdown-all only while the provider has a live callable shutdown", () => {
    attach([]);
    const button = shutdownAllButton();
    expect(button.disabled).toBeTrue();
    expect(
      lumine.commands.canDispatch(component.element, "jupyter-monitor:shutdown-all"),
    ).toBeFalse();

    const unsupported = fakeKernel("Unsupported", { shutdown: null });
    const destroyed = fakeKernel("Destroyed", { isDestroyed: () => true });
    provider.setKernels([unsupported, destroyed]);
    flush();
    expect(button.disabled).toBeTrue();
    expect(
      lumine.commands.canDispatch(component.element, "jupyter-monitor:shutdown-all"),
    ).toBeFalse();

    const live = fakeKernel("Live");
    provider.setKernels([unsupported, destroyed, live]);
    flush();
    expect(button.disabled).toBeFalse();
    expect(
      lumine.commands.canDispatch(component.element, "jupyter-monitor:shutdown-all"),
    ).toBeTrue();

    provider.setKernels([]);
    flush();
    expect(button.disabled).toBeTrue();
    expect(
      lumine.commands.canDispatch(component.element, "jupyter-monitor:shutdown-all"),
    ).toBeFalse();
    button.click();
    expect(live.shutdown).not.toHaveBeenCalled();
  });

  it("runs shutdown-all through its command for every live kernel despite focus and sort", async () => {
    const current = fakeKernel("Current");
    const focused = fakeKernel("Focused");
    const other = fakeKernel("Other");
    const unsupported = fakeKernel("Unsupported", { shutdown: null });
    const destroyed = fakeKernel("Destroyed", { isDestroyed: () => true });
    attach([current, focused, other, unsupported, destroyed]);
    component.move(1);
    component.sortBy("kernel");
    flush();

    await lumine.commands.dispatch(shutdownAllButton(), "jupyter-monitor:shutdown-all");
    for (const kernel of [current, focused, other]) {
      expect(kernel.shutdown).toHaveBeenCalledOnceWith();
    }
    expect(destroyed.shutdown).not.toHaveBeenCalled();
    expect(component.currentKernel()).toBe(current);
    expect(component.focusedKernel()).toBe(focused);
  });

  it("uses a snapshot when shutdown removes rows from the provider synchronously", async () => {
    const first = fakeKernel("First");
    const second = fakeKernel("Second");
    const third = fakeKernel("Third");
    attach([first, second, third]);
    for (const kernel of [first, second, third]) {
      kernel.shutdown.and.callFake(() => {
        provider.kernels.splice(provider.kernels.indexOf(kernel), 1);
      });
    }

    await component.shutdownAll();
    for (const kernel of [first, second, third]) {
      expect(kernel.shutdown).toHaveBeenCalledOnceWith();
    }
    expect(provider.kernels).toEqual([]);
  });

  it("reports each shutdown failure without skipping the remaining kernels", async () => {
    const rejected = fakeKernel("Rejected", {
      shutdown: jasmine.createSpy("rejected shutdown").and.rejectWith(new Error("Remote offline")),
    });
    const thrown = fakeKernel("Thrown", {
      shutdown: jasmine.createSpy("thrown shutdown").and.throwError("Kernel exited"),
    });
    const successful = fakeKernel("Successful");
    attach([rejected, thrown, successful]);
    spyOn(lumine.notifications, "addError");

    await component.shutdownAll();
    for (const kernel of [rejected, thrown, successful]) {
      expect(kernel.shutdown).toHaveBeenCalledOnceWith();
    }
    expect(lumine.notifications.addError).toHaveBeenCalledTimes(2);
    for (const detail of ["Remote offline", "Kernel exited"]) {
      expect(lumine.notifications.addError).toHaveBeenCalledWith("Jupyter kernel command failed", {
        detail,
        dismissable: true,
      });
    }
  });

  it("coalesces pending shutdowns across middle click, command and shutdown-all", async () => {
    let resolveShutdown;
    const completion = new Promise((resolve) => {
      resolveShutdown = resolve;
    });
    const kernel = fakeKernel("Pending", {
      shutdown: jasmine.createSpy("pending shutdown").and.returnValue(completion),
    });
    attach([kernel]);
    const row = rows()[0];
    mouse(row, "mouseup");
    const command = lumine.commands.dispatch(row, "jupyter-monitor:shutdown");
    const all = component.shutdownAll();
    mouse(row, "mouseup");
    expect(kernel.shutdown).toHaveBeenCalledOnceWith();

    resolveShutdown();
    await completion;
    await command;
    await all;
    await Promise.resolve();
    await component.shutdownAll();
    expect(kernel.shutdown).toHaveBeenCalledTimes(2);
  });

  it("retires row events and the shutdown-all command when the component is destroyed", async () => {
    const kernel = fakeKernel("Python");
    attach([kernel]);
    const element = component.element;
    const row = rows()[0];
    const button = shutdownAllButton();
    await component.destroy();

    mouse(row, "mouseup");
    button.click();
    expect(lumine.commands.canDispatch(element, "jupyter-monitor:shutdown-all")).toBeFalse();
    await lumine.commands.dispatch(element, "jupyter-monitor:shutdown-all");
    await component.shutdownAll();
    expect(kernel.shutdown).not.toHaveBeenCalled();
  });
});
