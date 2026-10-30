const { TextBuffer } = require("lumine");

describe("Monitor rename input budget", () => {
  let view;
  beforeEach(() => jasmine.useRealClock());
  afterEach(async () => {
    view?.close();
    await view?.destroyPromise;
  });
  it("preserves an oversized name and resumes confirmation after shortening", async () => {
    const RenameView = require("../lib/rename-view"),
      confirmed = jasmine.createSpy("confirmed");
    view = new RenameView({ prompt: "Name", defaultText: "previous" }, confirmed);
    let source = TextBuffer.createTextSnapshot("x".repeat(32768));
    while (source.canMaterialize()) source = source.replace(source.length, source.length, source);
    const editor = view.miniEditor,
      original = editor.getText;
    spyOn(editor, "getText").and.callFake(() => {
      if (editor.getBuffer().getLength() > 4096) throw new Error("oversized name was read");
      return original.call(editor);
    });
    editor.getBuffer().setText(source);
    view.confirm();
    expect(confirmed).not.toHaveBeenCalled();
    expect(view.closed).not.toBeTrue();
    expect(view.dialog.getQueryStatus().available).toBeFalse();
    expect(view.confirmButton.disabled).toBeTrue();
    await require("@lumine-code/etch").getScheduler().getNextUpdatePromise();
    expect(view.element.querySelector(".message-line.text-warning")).not.toBeNull();
    expect(editor.getBuffer().getTextSnapshot().equals(source)).toBeTrue();
    editor.setText("new name");
    expect(view.dialog.getQueryStatus().available).toBeTrue();
    expect(view.confirmButton.disabled).toBeFalse();
    view.confirm();
    expect(confirmed).toHaveBeenCalledOnceWith("new name");
    expect(view.closed).toBeTrue();
  });
});
