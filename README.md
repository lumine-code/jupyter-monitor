# jupyter-monitor

Watch every running Jupyter kernel in one table.

Kernels are started per file, so a session with several notebooks open has several of them. This shows all of them at once — what each is doing, how long its last execution took, and which files it serves — and lets you interrupt, restart or shut down any one without leaving the table.

## Features

- **Every kernel at once**: lists each running kernel with its gateway, state, execution count and last execution time.
- **Live state**: each row follows its own kernel, so a cell running anywhere shows up here immediately.
- **Kernel control**: interrupt, restart or shut down any kernel from its row.
- **Jump to the files**: a kernel lists the files it serves, and each one opens from the table.
- **Keyboard driven**: move through the table and act on the highlighted kernel without the mouse.
- **Kernel specs**: the kernel's name opens the full spec it was started from.

## Installation

To install `jupyter-monitor` search for _jupyter-monitor_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/jupyter-monitor`.

It reads its kernels from [`jupyter-repl`](https://github.com/lumine-code/jupyter-repl), which needs to be installed too.

## Commands

Commands available in `atom-workspace`:

- `jupyter-monitor:toggle`: open the kernel monitor, or return focus to the editor when it already has it.

Commands available in `.monitor-wrapper`:

- `jupyter-monitor:open`: open every file the targeted kernel serves,
- `jupyter-monitor:interrupt`: interrupt the targeted kernel,
- `jupyter-monitor:restart`: restart the targeted kernel,
- `jupyter-monitor:shutdown`: shut the targeted kernel down.

The panel also answers the core commands: `core:move-up` / `core:move-down` move the keyboard cursor, `core:confirm` opens the cursor's files, `core:cancel` clears the cursor.

## Usage

The tinted row is the kernel of the file you are editing, and it follows along as you switch tabs; a tab no kernel serves tints nothing. With the panel focused, the arrow keys move a separate dotted cursor, the way the linter panel drives its list: none exists until the first arrow press, which steps off the tinted row when there is one and enters from the top or bottom otherwise; enter opens the cursor row files and drops the cursor, and escape drops it and returns focus to the editor. Keyboard actions target the cursor when it is placed, the tinted row otherwise; clicking a row opens the files its kernel serves.

## Customization

Paste this into your `styles.less` to make the table more compact:

```less
.jupyter-monitor {
  .monitor-table th,
  .monitor-table td {
    padding: 0.1em 0.3em;
  }
}
```

## Services

- **jupyter.kernel** (`^1.0.0`): consumed to read the running kernels, follow the active one, and control any of them.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
