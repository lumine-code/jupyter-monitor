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

- `jupyter-monitor:up`: highlight the kernel above,
- `jupyter-monitor:down`: highlight the kernel below,
- `jupyter-monitor:open`: open every file the highlighted kernel serves,
- `jupyter-monitor:interrupt`: interrupt the highlighted kernel,
- `jupyter-monitor:restart`: restart the highlighted kernel,
- `jupyter-monitor:shutdown`: shut the highlighted kernel down.

## Usage

The highlight follows the kernel of the file you are editing, so opening the monitor already points at the one you were working with. Arrow keys move it, and it stays where you put it until you switch files.

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
