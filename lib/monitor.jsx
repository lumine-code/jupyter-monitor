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

const interrupt = (kernel) => kernel.interrupt();
const restart = (kernel) => kernel.restart();
const shutdown = (kernel) => kernel.shutdown();

const rename = (kernel) => {
  // Only a remote session can be renamed, and only the provider knows how.
  if (kernel.promptRename) {
    kernel.promptRename();
  }
};

const kernelKeys = new WeakMap();
let nextKernelKey = 1;

const getKernelKey = (kernel) => {
  if (kernel.id) {
    return kernel.id;
  }
  if (!kernelKeys.has(kernel)) {
    kernelKeys.set(kernel, `monitor-${nextKernelKey++}`);
  }
  return kernelKeys.get(kernel);
};

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
    lumine.notifications.addError("jupyter-monitor", { description: error });
  });
};

/**
 * Every running kernel, with its state and the files it serves.
 */
class Monitor {
  constructor({ provider }) {
    this.provider = provider;
    // Two independent row states, the way the linter panel draws its list:
    // `current` marks the kernel of the file active in the workspace centre
    // and is always tinted; `focused` is the keyboard cursor, an outline the
    // stylesheet only shows while the panel has focus.
    this.focusedKey = null;
    this.activeKernel = null;
    // One status subscription per kernel, rebuilt whenever the set changes.
    this.kernelSubscriptions = new CompositeDisposable();

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
          this.confirmFocused();
        },
        "core:cancel": (event) => {
          event.stopPropagation();
          this.cancelFocus();
        },
        "jupyter-monitor:open": {
          description: "Open the file the selected kernel is serving.",
          didDispatch: () => this.openFiles(),
        },
        "jupyter-monitor:interrupt": {
          description: "Interrupt the kernel selected in the monitor.",
          didDispatch: () => this.act(interrupt),
        },
        "jupyter-monitor:restart": {
          description: "Restart the kernel selected in the monitor.",
          didDispatch: () => this.act(restart),
        },
        "jupyter-monitor:shutdown": {
          description: "Shut down the kernel selected in the monitor.",
          didDispatch: () => this.act(shutdown),
        },
      }),
      // Leaving the panel ends the keyboard journey too: the cursor does not
      // lie in wait to reappear on the next visit.
      addDomListener(this.element, "focusout", (event) => {
        if (!this.element.contains(event.relatedTarget)) {
          this.focusedKey = null;
          etch.update(this);
        }
      }),
      this.provider.observeActiveKernel((kernel) => {
        this.activeKernel = kernel;
        etch.update(this);
      }),
      this.provider.onDidChangeKernels(() => this.watchKernels()),
    );

    this.watchKernels();
  }

  // Each row shows a kernel's live state, which only that kernel announces, so
  // the table listens to every running kernel rather than to the provider alone.
  watchKernels() {
    this.kernelSubscriptions.dispose();
    this.kernelSubscriptions = new CompositeDisposable();
    for (const kernel of this.kernels()) {
      if (kernel.onDidChangeStatus) {
        this.kernelSubscriptions.add(kernel.onDidChangeStatus(() => etch.update(this)));
      }
    }
    etch.update(this);
  }

  kernels() {
    return this.provider.getRunningKernels();
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

  move(delta) {
    const kernels = this.kernels();
    if (!kernels.length) {
      return;
    }
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
    this.openFilesFor(kernel);
  }

  // Escape drops the cursor and hands focus back to the editor.
  cancelFocus() {
    this.focusedKey = null;
    etch.update(this);
    lumine.workspace.getActiveTextEditor()?.element?.focus();
  }

  act(fn) {
    const kernel = this.targetKernel();
    if (kernel) {
      fn(kernel);
    }
  }

  openFiles() {
    this.openFilesFor(this.targetKernel());
  }

  openFilesFor(kernel) {
    if (!kernel) {
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

  // The row itself is a hyperlink to the kernel's files, the way a linter row
  // jumps to its message. Anything that is a link of its own — the file
  // links, the action icons, the kernel-spec name — keeps its own click.
  // The keyboard cursor stays where it is: only keyboard navigation places it.
  handleRowClick(event, kernel) {
    if (event.target.closest("a")) {
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
          <a onClick={openFile} title="Jump to file">
            {isUnsavedFilePath(filePath) ? filePath : tildify(filePath)}
          </a>
        </span>
      );
    });
  }

  renderRow(kernel, currentKey, focusedKey) {
    const key = getKernelKey(kernel);
    const isRemote = Boolean(kernel.gatewayName);
    const files = this.provider.getFilesForKernel(kernel);
    const classes = ["monitor-row"];
    if (key === currentKey) {
      classes.push("current");
    }
    if (key === focusedKey) {
      classes.push("focused");
    }

    return (
      <tr
        key={key}
        className={classes.join(" ")}
        onClick={(event) => this.handleRowClick(event, kernel)}
      >
        <td className="monitor-gateway">{kernel.gatewayName || "Local"}</td>
        <td className="monitor-kernel">
          <a onClick={() => showKernelSpec(kernel)} title="Show kernel spec">
            {kernel.displayName || "Unknown"}
          </a>
        </td>
        <td className="monitor-status">{kernel.executionState || "unknown"}</td>
        <td className="monitor-count">{String(kernel.executionCount ?? 0)}</td>
        <td className="monitor-time">{kernel.lastExecutionTime || "N/A"}</td>
        <td className="monitor-managements">
          <a className="icon icon-zap" onClick={() => interrupt(kernel)} title="Interrupt kernel" />
          <a className="icon icon-sync" onClick={() => restart(kernel)} title="Restart kernel" />
          {isRemote ? (
            <a className="icon icon-pencil" onClick={() => rename(kernel)} title="Rename session" />
          ) : null}
          <a
            className="icon icon-trashcan"
            onClick={() => shutdown(kernel)}
            title="Shutdown kernel"
          />
        </td>
        <td className="monitor-files">{this.renderFileLinks(files)}</td>
      </tr>
    );
  }

  render() {
    const kernels = this.kernels();
    const current = this.currentKernel(kernels);
    const currentKey = current ? getKernelKey(current) : null;

    return (
      <div className="monitor-wrapper" tabIndex={-1}>
        <table className="monitor-table">
          <thead>
            <tr className="monitor-header">
              <th>Gateway</th>
              <th>Kernel</th>
              <th>Status</th>
              <th>Count</th>
              <th>Last Exec Time</th>
              <th>Managements</th>
              <th>Files</th>
            </tr>
          </thead>
          <tbody>
            {kernels.map((kernel) => this.renderRow(kernel, currentKey, this.focusedKey))}
          </tbody>
        </table>
      </div>
    );
  }

  update() {
    return etch.update(this);
  }

  destroy() {
    this.kernelSubscriptions.dispose();
    this.disposables.dispose();
    return etch.destroy(this);
  }
}

module.exports = Monitor;
