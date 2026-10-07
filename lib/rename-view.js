const { CompositeDisposable, Disposable } = require("lumine");

class RenameView {
  constructor({ prompt, defaultText }, onConfirmed, onCancelled) {
    this.onConfirmed = onConfirmed;
    this.onCancelled = onCancelled;
    this.element = document.createElement("div");
    this.element.classList.add("jupyter-monitor", "rename-view");
    const label = document.createElement("div");
    label.classList.add("label", "icon", "icon-pencil");
    label.textContent = prompt;
    this.miniEditor = lumine.workspace.buildTextEditor({ mini: true });
    this.miniEditor.setText(defaultText || "");
    this.disposables = new CompositeDisposable(
      lumine.textEditors.add(this.miniEditor, { role: "input" }),
      lumine.commands.add(this.element, {
        "core:confirm": (event) => {
          event.stopPropagation();
          this.confirm();
        },
        "core:cancel": (event) => {
          event.stopPropagation();
          this.cancel();
        },
      }),
    );
    const blur = () => {
      if (document.hasFocus()) this.cancel();
    };
    this.miniEditor.element.addEventListener("blur", blur);
    this.disposables.add(
      new Disposable(() => this.miniEditor?.element.removeEventListener("blur", blur)),
    );
    this.element.append(label, this.miniEditor.element);
  }

  attach() {
    if (this.closed) return;
    this.previousFocus = document.activeElement;
    this.panel = lumine.workspace.addModalPanel({ item: this.element });
    this.miniEditor.element.focus();
    this.miniEditor.scrollToCursorPosition();
  }

  confirm() {
    if (this.closed || !this.miniEditor) return;
    const text = this.miniEditor.getText();
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
    this.panel?.destroy();
    this.panel = null;
    this.miniEditor?.destroy();
    this.miniEditor = null;
    this.element.remove();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
}

module.exports = RenameView;
