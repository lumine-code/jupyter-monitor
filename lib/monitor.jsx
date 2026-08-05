const etch = require("@lumine-code/etch");
const { CompositeDisposable } = require("atom");
const { isUnsavedFilePath, tildify } = require("./utils");

const showKernelSpec = (kernel) => {
  atom.notifications.addInfo("Kernel Spec", {
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
  const editor = atom.workspace.getTextEditors().find((candidate) => {
    const match = filePath.match(/\d+/);
    return match ? String(candidate.id) === match[0] : false;
  });
  if (editor) {
    atom.workspace.open(editor, { searchAllPanes: true });
  }
};

const openEditor = (filePath) => {
  atom.workspace.open(filePath, { searchAllPanes: true }).catch((error) => {
    atom.notifications.addError("jupyter-monitor", { description: error });
  });
};

/**
 * Every running kernel, with its state and the files it serves.
 */
class Monitor {
  constructor({ provider }) {
    this.provider = provider;
    this.selectedKey = null;
    // One status subscription per kernel, rebuilt whenever the set changes.
    this.kernelSubscriptions = new CompositeDisposable();

    etch.initialize(this);

    this.disposables = new CompositeDisposable(
      atom.commands.add(this.element, {
        "jupyter-monitor:up": () => this.move(-1),
        "jupyter-monitor:down": () => this.move(1),
        "jupyter-monitor:open": () => this.openFiles(),
        "jupyter-monitor:interrupt": () => this.act(interrupt),
        "jupyter-monitor:restart": () => this.act(restart),
        "jupyter-monitor:shutdown": () => this.act(shutdown),
      }),
      // The highlight follows the kernel of the active centre pane item, so a
      // manual arrow-key selection is cleared when that item changes.
      atom.workspace.getCenter().onDidChangeActivePaneItem(() => {
        this.selectedKey = null;
        etch.update(this);
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

  // The highlighted kernel: a manual selection if one is set, otherwise the
  // kernel of the file active in the workspace centre — as observed off the
  // provider, so every change arrives after jupyter-repl has processed it —
  // otherwise the first, so a keyboard action always has a target.
  selectedKernel(kernels = this.kernels()) {
    if (!kernels.length) {
      return null;
    }
    if (this.selectedKey) {
      const manual = kernels.find((kernel) => getKernelKey(kernel) === this.selectedKey);
      if (manual) {
        return manual;
      }
    }
    if (this.activeKernel && kernels.includes(this.activeKernel)) {
      return this.activeKernel;
    }
    return kernels[0];
  }

  move(delta) {
    const kernels = this.kernels();
    if (!kernels.length) {
      return;
    }
    const current = this.selectedKernel(kernels);
    let index = current ? kernels.indexOf(current) : 0;
    index = Math.min(kernels.length - 1, Math.max(0, index + delta));
    this.selectedKey = getKernelKey(kernels[index]);
    etch.update(this);
  }

  act(fn) {
    const kernel = this.selectedKernel();
    if (kernel) {
      fn(kernel);
    }
  }

  openFiles() {
    const kernel = this.selectedKernel();
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

  select(key) {
    this.selectedKey = key;
    etch.update(this);
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

  renderRow(kernel, selectedKey) {
    const key = getKernelKey(kernel);
    const isRemote = Boolean(kernel.gatewayName);
    const files = this.provider.getFilesForKernel(kernel);

    return (
      <tr
        key={key}
        className={key === selectedKey ? "monitor-row selected" : "monitor-row"}
        onClick={() => this.select(key)}
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
    const selected = this.selectedKernel(kernels);
    const selectedKey = selected ? getKernelKey(selected) : null;

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
          <tbody>{kernels.map((kernel) => this.renderRow(kernel, selectedKey))}</tbody>
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
