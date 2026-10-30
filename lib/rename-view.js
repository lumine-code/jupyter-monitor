const { CompositeDisposable } = require("lumine");

class RenameView {
  constructor({ prompt, defaultText }, onConfirmed, onCancelled) {
    this.onConfirmed = onConfirmed;
    this.onCancelled = onCancelled;
    this.defaultText = defaultText || "";
    const header = document.createElement("header");
    header.className = "dialog-header";
    const title = document.createElement("h2");
    title.className = "dialog-title icon icon-pencil";
    title.textContent = prompt;
    header.append(title);
    const footer = document.createElement("div");
    footer.className = "dialog-footer dialog-actions";
    const cancel = document.createElement("button");
    cancel.className = "btn";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.cancel());
    this.confirmButton = document.createElement("button");
    this.confirmButton.className = "btn btn-primary";
    this.confirmButton.type = "button";
    this.confirmButton.textContent = "Rename";
    this.confirmButton.addEventListener("click", () => this.confirm());
    footer.append(cancel, this.confirmButton);
    this.dialog = lumine.workspace.buildInputDialog({
      query: this.defaultText,
      maxQueryLength: 4096,
      headerElement: header,
      contentElement: footer,
    });
    this.element = this.dialog.getElement();
    this.element.classList.add("jupyter-monitor", "rename-view");
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", prompt);
    this.miniEditor = this.dialog.getQueryEditor();
    this.miniEditor.element.setAttribute("aria-label", "Session name");
    this.disposables = new CompositeDisposable(
      this.dialog.onDidConfirm(({ query }) => this.didConfirm(query)),
      this.miniEditor.getBuffer().onDidChangeText(() => {
        this.confirmButton.disabled = !this.dialog.getQueryStatus().available;
      }),
    );
    this.confirmButton.disabled = !this.dialog.getQueryStatus().available;
  }

  attach() {
    if (this.closed || this.host) return;
    this.host = lumine.workspace.addInputDialog(this.dialog);
    this.disposables.add(
      this.host.onDidCancel(() => this.cancel()),
      this.host.onDidDestroy(() => this.cancel()),
    );
    void this.host.show({ query: this.defaultText });
  }

  confirm() {
    if (this.closed) return;
    this.dialog.confirm();
  }

  didConfirm(text) {
    if (this.closed) return;
    const callback = this.onConfirmed;
    this.close();
    callback?.(text);
  }

  cancel() {
    if (this.closed) return;
    const callback = this.onCancelled;
    this.close();
    callback?.();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.disposables.dispose();
    this.element.remove();
    this.destroyPromise = this.dialog.destroy();
    this.miniEditor = null;
  }
}

module.exports = RenameView;
