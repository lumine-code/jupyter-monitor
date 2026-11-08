/** @jsx etch.dom */
const etch = require("@lumine-code/etch");

// An addEventListener paired with its removal, in the shape CompositeDisposable takes.
function addDomListener(element, event, handler) {
  element.addEventListener(event, handler);
  return { dispose: () => element.removeEventListener(event, handler) };
}
const { CompositeDisposable } = require("lumine");
const { isUnsavedFilePath, tildify } = require("./utils");

const showKernelSpec = (kernel) => {
  lumine.notifications.addInfo("Kernel Spec", {
    detail: JSON.stringify(kernel.kernelSpec, null, 2),
    dismissable: true,
  });
};

function runKernelAction(kernel, action, ...args) {
  const reportError = (error) => {
    lumine.notifications.addError("Jupyter kernel command failed", {
      detail: error.message || String(error),
      dismissable: true,
    });
  };
  try {
    const result = kernel[action](...args);
    return result?.catch ? result.catch(reportError) : result;
  } catch (error) {
    reportError(error);
  }
}

const interrupt = (kernel) => runKernelAction(kernel, "interrupt");
const restart = (kernel) => runKernelAction(kernel, "restart");
const shutdown = (kernel) => runKernelAction(kernel, "shutdown");

const getKernelKey = (kernel) => kernel.id;
const kernelNames = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const getKernelStatus = (kernel) =>
  kernel.connectionState && kernel.connectionState !== "ready"
    ? kernel.connectionState
    : kernel.executionState || "unknown";

// The service exposes the last execution's elapsed duration as display text,
// using seconds, minutes and hours. Unavailable values belong after real times.
function executionDuration(value) {
  if (typeof value !== "string") return null;
  const pattern = /(\d+(?:\.\d+)?)\s*(ms|min|sec|h|m|s)\b/g;
  const parts = [...value.matchAll(pattern)];
  if (!parts.length || value.replace(pattern, "").trim()) return null;
  const units = { ms: 1, min: 60000, sec: 1000, h: 3600000, m: 60000, s: 1000 };
  const duration = parts.reduce(
    (total, [, amount, unit]) => total + Number(amount) * units[unit],
    0,
  );
  return Number.isFinite(duration) ? duration : null;
}

const openUnsavedEditor = (filePath) => {
  const editor = lumine.workspace.getTextEditors().find((candidate) => {
    const match = filePath.match(/\d+/);
    return match ? String(candidate.id) === match[0] : false;
  });
  if (editor) {
    lumine.workspace.open(editor, { searchAllPanes: true });
  }
};

const openEditor = (filePath) => {
  lumine.workspace.open(filePath, { searchAllPanes: true }).catch((error) => {
    lumine.notifications.addError("Jupyter kernel monitor", { description: error });
  });
};

/**
 * Every running kernel, with its state and the files it serves.
 */
class Monitor {
  constructor({ provider, providerAvailable = true }) {
    this.provider = provider;
    this.providerAvailable = providerAvailable;
    this.sortColumn = null;
    this.sortDirection = "ascending";
    // Two independent row states, the way the diagnostics panel draws its list:
    // `current` marks the kernel of the file active in the workspace centre
    // and is always tinted; `focused` is the keyboard cursor, an outline the
    // stylesheet only shows while the panel has focus.
    this.focusedKey = null;
    this.activeKernel = null;
    // One status subscription per kernel, rebuilt whenever the set changes.
    this.kernelSubscriptions = new Map();
    this.pendingRenames = new Set();
    this.pendingShutdowns = new Map();
    this.rowKernels = new WeakMap();

    etch.initialize(this);

    this.disposables = new CompositeDisposable(
      lumine.commands.add(this.element, {
        "core:move-up": (event) => {
          event.stopPropagation();
          this.move(-1);
        },
        "core:move-down": (event) => {
          event.stopPropagation();
          this.move(1);
        },
        "core:confirm": (event) => {
          event.stopPropagation();
          if (event.target.closest?.("button")) return;
          this.confirmFocused();
        },
        "core:cancel": (event) => {
          event.stopPropagation();
          this.cancelFocus();
        },
        "jupyter-monitor:open-files": {
          description: "Open the file the selected kernel is serving.",
          isAvailable: (event) => Boolean(this.kernelForEvent(event)),
          didDispatch: (event) => this.openFiles(event),
        },
        "jupyter-monitor:show-kernel-spec": {
          description: "Show the selected kernel's launch specification.",
          isAvailable: (event) => Boolean(this.kernelForEvent(event)),
          didDispatch: (event) => this.act(showKernelSpec, event),
        },
        "jupyter-monitor:interrupt": {
          description: "Interrupt the kernel selected in the monitor.",
          isAvailable: (event) => this.canAct(event, "interrupt"),
          didDispatch: (event) => this.act(interrupt, event),
        },
        "jupyter-monitor:restart": {
          description: "Restart the kernel selected in the monitor.",
          isAvailable: (event) => this.canAct(event, "restart"),
          didDispatch: (event) => this.act(restart, event),
        },
        "jupyter-monitor:rename-session": {
          description: "Rename the selected remote session.",
          isAvailable: (event) =>
            this.canAct(event, "rename") &&
            Boolean(this.kernelForEvent(event)?.capabilities?.rename),
          didDispatch: (event) => this.act((kernel) => this.promptRename(kernel), event),
        },
        "jupyter-monitor:shutdown": {
          description: "Shut down the kernel selected in the monitor.",
          isAvailable: (event) => this.canShutdownKernel(this.kernelForEvent(event)),
          didDispatch: (event) => this.shutdownKernel(this.kernelForEvent(event)),
        },
        "jupyter-monitor:shutdown-all": {
          description: "Shut down every running kernel in the monitor.",
          isAvailable: () =>
            this.provider.getRunningKernels().some((kernel) => this.canShutdownKernel(kernel)),
          didDispatch: () => this.shutdownAll(),
        },
      }),
      addDomListener(this.element, "mousedown", (event) => {
        if (event.button === 1 && event.target.closest?.(".monitor-row")) event.preventDefault();
      }),
      addDomListener(this.element, "mouseup", (event) => {
        if (event.button !== 1 || !event.target.closest?.(".monitor-row")) return;
        event.preventDefault();
        this.shutdownKernel(this.kernelForEvent(event));
      }),
      addDomListener(this.element, "auxclick", (event) => {
        if (event.button === 1 && event.target.closest?.(".monitor-row")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }),
      // Leaving the panel ends the keyboard journey too: the cursor does not
      // lie in wait to reappear on the next visit.
      addDomListener(this.element, "focusout", (event) => {
        if (!this.element.contains(event.relatedTarget)) {
          this.focusedKey = null;
          etch.update(this);
          lumine.commands.invalidateAvailability();
        }
      }),
      this.provider.observeActiveKernel((kernel) => {
        if (this.destroyed) return;
        this.activeKernel = kernel;
        etch.update(this);
        lumine.commands.invalidateAvailability();
      }),
      this.provider.onDidChangeKernels(() => this.watchKernels()),
    );

    const shutdownButton = this.element.querySelector(".monitor-shutdown-all");
    this.disposables.add(
      lumine.tooltips.add(shutdownButton, {
        html: false,
        title: () => shutdownButton.dataset.tooltip,
      }),
    );

    this.watchKernels();
  }

  promptRename(kernel) {
    if (!this.liveKernel(kernel) || !kernel.capabilities?.rename) return;
    const InputView = require("./rename-view");
    const generation = kernel.generation;
    const ownership = new CompositeDisposable();
    let view;
    const close = () => {
      this.pendingRenames.delete(close);
      ownership.dispose();
      view?.close();
    };
    view = new InputView(
      { prompt: "Name your current session", defaultText: kernel.displayName, allowCancel: true },
      (name) => {
        close();
        if (!this.liveKernel(kernel) || generation !== kernel.generation) return;
        runKernelAction(kernel, "rename", name);
      },
      close,
    );
    this.pendingRenames.add(close);
    if (kernel.onDidChangeGeneration) ownership.add(kernel.onDidChangeGeneration(close));
    if (kernel.onDidDestroy) ownership.add(kernel.onDidDestroy(close));
    view.attach();
  }

  // Each row shows a kernel's live state, which only that kernel announces, so
  // the table listens to every running kernel rather than to the provider alone.
  watchKernels() {
    if (this.destroyed) return;
    const kernels = new Set(this.kernels());
    for (const [kernel, subscription] of this.kernelSubscriptions) {
      if (!kernels.has(kernel)) {
        subscription.dispose();
        this.kernelSubscriptions.delete(kernel);
      }
    }
    for (const kernel of kernels) {
      if (!this.kernelSubscriptions.has(kernel) && kernel.onDidChangeStatus) {
        const update = () => {
          if (!this.destroyed) {
            etch.update(this);
            lumine.commands.invalidateAvailability();
          }
        };
        const subscriptions = new CompositeDisposable(kernel.onDidChangeStatus(update));
        if (kernel.onDidChangeConnectionState)
          subscriptions.add(kernel.onDidChangeConnectionState(update));
        this.kernelSubscriptions.set(kernel, subscriptions);
      }
    }
    etch.update(this);
    lumine.commands.invalidateAvailability();
  }

  kernels() {
    const kernels = [...this.provider.getRunningKernels()];
    if (!this.sortColumn) return kernels;
    const direction = this.sortDirection === "ascending" ? 1 : -1;
    return kernels
      .map((kernel, index) => ({ kernel, index, value: this.sortValue(kernel) }))
      .sort((left, right) => {
        if (left.value === null || right.value === null) {
          if (left.value !== right.value) return left.value === null ? 1 : -1;
        } else {
          const difference =
            typeof left.value === "number"
              ? left.value - right.value
              : kernelNames.compare(left.value, right.value);
          if (difference) return difference * direction;
        }
        return left.index - right.index;
      })
      .map(({ kernel }) => kernel);
  }

  sortValue(kernel) {
    switch (this.sortColumn) {
      case "gateway":
        return kernel.gatewayName || "Local";
      case "kernel":
        return kernel.displayName || "Unknown";
      case "status":
        return getKernelStatus(kernel);
      case "count":
        return Number.isFinite(kernel.executionCount) ? kernel.executionCount : 0;
      case "time":
        return executionDuration(kernel.lastExecutionTime);
      case "files":
        return this.provider.getFilesForKernel(kernel).map(tildify).join(" | ") || null;
      default:
        return null;
    }
  }

  sortBy(column) {
    this.sortDirection =
      this.sortColumn === column && this.sortDirection === "ascending" ? "descending" : "ascending";
    this.sortColumn = column;
    etch.update(this);
  }

  // The kernel of the file active in the workspace centre — as observed off
  // the provider, so every change arrives after jupyter-repl has processed
  // it. No kernel for the active file means no current row.
  currentKernel(kernels = this.kernels()) {
    if (this.activeKernel && kernels.includes(this.activeKernel)) {
      return this.activeKernel;
    }
    return null;
  }

  // The keyboard cursor's kernel, when the cursor is on a live row.
  focusedKernel(kernels = this.kernels()) {
    if (!this.focusedKey) {
      return null;
    }
    return kernels.find((kernel) => getKernelKey(kernel) === this.focusedKey) || null;
  }

  // What a keyboard action operates on: the cursor when it is placed,
  // otherwise the current row.
  targetKernel(kernels = this.kernels()) {
    return this.focusedKernel(kernels) || this.currentKernel(kernels);
  }

  liveKernel(kernel) {
    if (this.destroyed || !kernel || kernel.isDestroyed?.()) return null;
    return this.provider.getRunningKernels().includes(kernel) ? kernel : null;
  }

  // A context command belongs to the clicked row, even when another kernel
  // owns the keyboard cursor. Removed rows must never fall back to that cursor.
  kernelForEvent(event) {
    if (this.destroyed) return null;
    const row = event?.target?.closest?.(".monitor-row");
    if (row) {
      return this.element.contains(row) ? this.liveKernel(this.rowKernels.get(row)) : null;
    }
    return this.liveKernel(this.targetKernel());
  }

  canAct(event, action) {
    return typeof this.kernelForEvent(event)?.[action] === "function";
  }

  canShutdownKernel(kernel) {
    return Boolean(
      this.liveKernel(kernel) &&
      typeof kernel.shutdown === "function" &&
      !this.pendingShutdowns.has(kernel),
    );
  }

  shutdownKernel(kernel) {
    if (this.pendingShutdowns.has(kernel)) return this.pendingShutdowns.get(kernel);
    if (!this.canShutdownKernel(kernel)) return Promise.resolve();
    // Mark the operation before calling into the provider: a synchronous
    // removal or another gesture must not submit the same shutdown twice.
    this.pendingShutdowns.set(kernel, null);
    const result = shutdown(kernel);
    const completion = Promise.resolve(result).finally(() => {
      this.pendingShutdowns.delete(kernel);
      if (!this.destroyed) {
        etch.update(this);
        lumine.commands.invalidateAvailability();
      }
    });
    this.pendingShutdowns.set(kernel, completion);
    if (!this.destroyed) {
      etch.update(this);
      lumine.commands.invalidateAvailability();
    }
    return completion;
  }

  shutdownAll() {
    const kernels = [...new Set(this.provider.getRunningKernels())];
    return Promise.all(kernels.map((kernel) => this.shutdownKernel(kernel)));
  }

  move(delta) {
    const kernels = this.kernels();
    if (!kernels.length) {
      return;
    }
    lumine.scrollbars.reveal(this.element);
    // The cursor moves relative to where it is — or, on the first press,
    // relative to the current row, so going down from the tinted kernel
    // reaches its neighbour rather than re-marking it. With neither, the
    // list is entered from the end the key came from.
    const origin = this.focusedKernel(kernels) || this.currentKernel(kernels);
    let index;
    if (origin) {
      index = Math.min(kernels.length - 1, Math.max(0, kernels.indexOf(origin) + delta));
    } else {
      index = delta > 0 ? 0 : kernels.length - 1;
    }
    this.focusedKey = getKernelKey(kernels[index]);
    etch.update(this);
    lumine.commands.invalidateAvailability();
  }

  // Enter is the end of a keyboard journey: it needs a cursor, opens that
  // kernel's files, and takes the cursor with it.
  confirmFocused() {
    const kernel = this.focusedKernel();
    if (!kernel) {
      return;
    }
    this.focusedKey = null;
    etch.update(this);
    lumine.commands.invalidateAvailability();
    this.openFilesFor(kernel);
  }

  // Escape drops the cursor and hands focus back to the editor.
  cancelFocus() {
    this.focusedKey = null;
    etch.update(this);
    lumine.commands.invalidateAvailability();
    lumine.workspace.getActiveTextEditor()?.element?.focus();
  }

  act(fn, event) {
    const kernel = this.kernelForEvent(event);
    if (kernel) {
      return fn(kernel);
    }
  }

  openFiles(event) {
    this.openFilesFor(this.kernelForEvent(event));
  }

  openFilesFor(kernel) {
    if (!this.liveKernel(kernel)) {
      return;
    }
    for (const filePath of this.provider.getFilesForKernel(kernel)) {
      if (isUnsavedFilePath(filePath)) {
        openUnsavedEditor(filePath);
      } else {
        openEditor(filePath);
      }
    }
  }

  // The row opens the kernel's files. Its plain kernel-name cell is passive,
  // while individual file links keep their own navigation.
  // The keyboard cursor stays where it is: only keyboard navigation places it.
  handleRowClick(event, kernel) {
    if (event.button !== 0 || event.target.closest("a, button, .monitor-kernel")) {
      return;
    }
    this.openFilesFor(kernel);
  }

  renderFileLinks(files) {
    return files.map((filePath, index) => {
      const openFile = isUnsavedFilePath(filePath)
        ? () => openUnsavedEditor(filePath)
        : () => openEditor(filePath);

      return (
        <span key={filePath}>
          {index === 0 ? "" : "  |  "}
          <a onClick={openFile}>{isUnsavedFilePath(filePath) ? filePath : tildify(filePath)}</a>
        </span>
      );
    });
  }

  renderRow(kernel, currentKey, focusedKey) {
    const key = getKernelKey(kernel);
    const kernelName = kernel.displayName || "Unknown";
    const files = this.provider.getFilesForKernel(kernel);
    const classes = ["monitor-row", "data-table-row"];
    if (key === currentKey) {
      classes.push("current");
    }
    if (key === focusedKey) {
      classes.push("focused");
    }

    return (
      <tr
        key={kernel}
        ref={(row) => {
          if (row) this.rowKernels.set(row, kernel);
        }}
        className={classes.join(" ")}
        onClick={(event) => this.handleRowClick(event, kernel)}
      >
        <td className="monitor-gateway">{kernel.gatewayName || "Local"}</td>
        <td className="monitor-kernel">{kernelName}</td>
        <td className="monitor-status">{getKernelStatus(kernel)}</td>
        <td className="monitor-count">{String(kernel.executionCount ?? 0)}</td>
        <td className="monitor-time">{kernel.lastExecutionTime || "N/A"}</td>
        <td className="monitor-files">{this.renderFileLinks(files)}</td>
      </tr>
    );
  }

  renderHeader(column, label) {
    const sort = (
      <button
        type="button"
        className="data-table-sort native-key-bindings"
        onClick={() => this.sortBy(column)}
      >
        <span className="data-table-sort-label">{label}</span>
      </button>
    );
    return (
      <th
        scope="col"
        attributes={{ "aria-sort": this.sortColumn === column ? this.sortDirection : "none" }}
      >
        {column === "files" ? (
          <div className="data-table-header-controls">
            {sort}
            <button
              type="button"
              className="monitor-shutdown-all data-table-header-action native-key-bindings icon icon-x"
              dataset={{ tooltip: "Shutdown all" }}
              attributes={{ "aria-label": "Shutdown all" }}
              disabled={
                !this.provider.getRunningKernels().some((kernel) => this.canShutdownKernel(kernel))
              }
              onClick={() => this.shutdownAll()}
            />
          </div>
        ) : (
          sort
        )}
      </th>
    );
  }

  render() {
    const kernels = this.kernels();
    const current = this.currentKernel(kernels);
    const currentKey = current ? getKernelKey(current) : null;

    return (
      <div
        className={`monitor-wrapper data-table-container${kernels.length ? "" : " is-empty"}`}
        tabIndex={-1}
        attributes={{ "data-scrollbar": "auto" }}
      >
        <table className="monitor-table data-table">
          <thead>
            <tr className="monitor-header">
              {this.renderHeader("gateway", "Gateway")}
              {this.renderHeader("kernel", "Kernel")}
              {this.renderHeader("status", "Status")}
              {this.renderHeader("count", "Count")}
              {this.renderHeader("time", "Last Exec Time")}
              {this.renderHeader("files", "Files")}
            </tr>
          </thead>
          <tbody>
            {kernels.map((kernel) => this.renderRow(kernel, currentKey, this.focusedKey))}
          </tbody>
        </table>
        {kernels.length ? null : (
          <div className="panel-empty-state">
            <background-tips>
              <ul className="centered background-message">
                <li>
                  {this.providerAvailable ? "No running kernels" : "Kernel service unavailable"}
                </li>
              </ul>
            </background-tips>
          </div>
        )}
      </div>
    );
  }

  update() {
    return etch.update(this);
  }

  destroy() {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    for (const close of this.pendingRenames) close();
    for (const subscription of this.kernelSubscriptions.values()) subscription.dispose();
    this.kernelSubscriptions.clear();
    this.disposables.dispose();
    return etch.destroy(this);
  }
}

module.exports = Monitor;
