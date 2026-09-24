import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

export interface MenuOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export class WizardCancelledError extends Error {
  constructor() {
    super("WIZARD_CANCELLED");
  }
}

const cyan = (value: string) => `\u001b[36m${value}\u001b[0m`;
const dim = (value: string) => `\u001b[2m${value}\u001b[0m`;
const green = (value: string) => `\u001b[32m${value}\u001b[0m`;
const red = (value: string) => `\u001b[31m${value}\u001b[0m`;
const bold = (value: string) => `\u001b[1m${value}\u001b[0m`;

export class TerminalWizard {
  constructor(
    private readonly input: NodeJS.ReadStream = process.stdin,
    private readonly output: NodeJS.WriteStream = process.stdout,
  ) {}

  async text(prompt: string, defaultValue = "") {
    const suffix = defaultValue ? ` ${dim(`[${defaultValue}]`)}` : "";
    const terminal = createInterface({
      input: this.input,
      output: this.output,
    });
    try {
      const value = (
        await terminal.question(`${cyan("›")} ${prompt}${suffix}: `)
      ).trim();
      return value || defaultValue;
    } finally {
      terminal.close();
    }
  }

  async withProgress<T>(
    message: string,
    operation: () => Promise<T>,
    completedMessage = message,
  ): Promise<T> {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const interactive = Boolean(this.output.isTTY && !process.env.NO_COLOR);
    const lineStart = this.output.isTTY ? "\u001b[2K\r" : "\r";
    let frame = 0;
    const render = () => {
      const indicator = frames[frame++ % frames.length] ?? "•";
      this.output.write(
        `${lineStart}${interactive ? cyan(indicator) : indicator} ${message}`,
      );
    };
    render();
    const timer = this.output.isTTY ? setInterval(render, 90) : undefined;
    try {
      const result = await operation();
      if (timer) clearInterval(timer);
      this.output.write(`${lineStart}${green("✓")} ${completedMessage}\n`);
      return result;
    } catch (error) {
      if (timer) clearInterval(timer);
      this.output.write(`${lineStart}${red("✗")} ${message}\n`);
      throw error;
    }
  }

  async select<T extends string>(
    title: string,
    prompt: string,
    options: MenuOption<T>[],
    initialIndex = 0,
  ): Promise<T> {
    if (!options.length) throw new Error("WIZARD_MENU_EMPTY");
    const index = await this.menu(title, prompt, options, initialIndex, false);
    const choice = options[index];
    if (!choice) throw new Error("WIZARD_SELECTION_INVALID");
    return choice.value;
  }

  async multiSelect<T extends string>(
    title: string,
    prompt: string,
    options: MenuOption<T>[],
    initialValues: T[],
  ): Promise<T[]> {
    if (!this.hasArrowInput()) {
      const choices = options
        .map((option, index) => `${index + 1}. ${option.label}`)
        .join("\n");
      const input = await this.text(
        `${prompt}\n${choices}\nNúmeros separados por coma, 'todas' o 'ninguna'`,
        "todas",
      );
      if (input.toLowerCase() === "ninguna") return [];
      if (input.toLowerCase() === "todas")
        return options.map((option) => option.value);
      const selected = input
        .split(",")
        .map((item) => options[Number(item.trim()) - 1]);
      if (selected.some((option) => !option))
        throw new Error("WIZARD_SELECTION_INVALID");
      return selected.map((option) => {
        if (!option) throw new Error("WIZARD_SELECTION_INVALID");
        return option.value;
      });
    }

    let activeIndex = 0;
    const selected = new Set(initialValues);
    return (await this.runKeyMenu(
      title,
      prompt,
      options,
      () => activeIndex,
      (next) => {
        activeIndex = next;
      },
      selected,
      true,
    )) as T[];
  }

  async searchableSelect<T extends string>(
    title: string,
    prompt: string,
    options: MenuOption<T>[],
  ): Promise<T> {
    while (true) {
      const query = (
        await this.text(
          `${prompt}\nFiltrar por proveedor, ID o nombre (vacío = todos)`,
          "",
        )
      ).toLocaleLowerCase();
      const filtered = query
        ? options.filter((option) =>
            `${option.label} ${option.description ?? ""}`
              .toLocaleLowerCase()
              .includes(query),
          )
        : options;
      if (!filtered.length) {
        this.output.write("No hay modelos que coincidan con ese filtro.\n");
        continue;
      }
      return this.select(
        title,
        `${prompt} · ${filtered.length} resultados`,
        filtered,
      );
    }
  }

  private hasArrowInput() {
    return Boolean(
      this.input.isTTY && this.output.isTTY && this.input.setRawMode,
    );
  }

  private async menu<T extends string>(
    title: string,
    prompt: string,
    options: MenuOption<T>[],
    initialIndex: number,
    multiple: false,
  ): Promise<number> {
    if (!this.hasArrowInput()) {
      const choices = options
        .map((option, index) => `${index + 1}. ${option.label}`)
        .join("\n");
      const answer = await this.text(`${prompt}\n${choices}`, "1");
      const index = Number(answer) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= options.length)
        throw new Error("WIZARD_SELECTION_INVALID");
      return index;
    }
    let activeIndex = Math.min(Math.max(initialIndex, 0), options.length - 1);
    const selected = new Set<T>();
    await this.runKeyMenu(
      title,
      prompt,
      options,
      () => activeIndex,
      (next) => {
        activeIndex = next;
      },
      selected,
      multiple,
    );
    return activeIndex;
  }

  private async runKeyMenu<T extends string>(
    title: string,
    prompt: string,
    options: MenuOption<T>[],
    getActive: () => number,
    setActive: (value: number) => void,
    selected: Set<T>,
    multiple: boolean,
  ): Promise<T[] | number> {
    if (!options.length) return multiple ? [] : 0;
    const input = this.input as NodeJS.ReadStream & {
      setRawMode: (mode: boolean) => void;
      isRaw?: boolean;
    };
    const wasRaw = input.isRaw ?? false;
    const useColor = Boolean(this.output.isTTY && !process.env.NO_COLOR);
    const paint = (value: string, color: (text: string) => string) =>
      useColor ? color(value) : value;
    const render = () => {
      const active = getActive();
      const lines = [
        "┌──────────────────────────────────────────────┐",
        `│ ${bold("PULSO")} ${dim("/ INSTALADOR V2")}                         │`,
        "└──────────────────────────────────────────────┘",
        "",
        bold(title),
        prompt,
        "",
      ];
      options.forEach((option, index) => {
        const focused = index === active;
        const checked = selected.has(option.value);
        const cursor = focused ? paint("❯", cyan) : " ";
        const marker = multiple ? (checked ? "[x]" : "[ ]") : "  ";
        const label = focused
          ? paint(option.label, (text) => `\u001b[1m${text}\u001b[0m`)
          : option.label;
        lines.push(` ${cursor} ${marker} ${label}`);
        if (option.description) lines.push(`       ${dim(option.description)}`);
      });
      lines.push(
        "",
        dim(
          multiple
            ? "↑/↓ mover · Espacio activar · a todas · n ninguna · Enter continuar · Esc cancelar"
            : "↑/↓ mover · Enter elegir · Esc cancelar",
        ),
      );
      this.output.write(`\u001b[2J\u001b[H${lines.join("\n")}\n`);
    };

    return new Promise<T[] | number>((resolve, reject) => {
      const finish = (value?: T[] | number, error?: Error) => {
        input.removeListener("keypress", onKeypress);
        input.setRawMode(wasRaw);
        this.output.write("\u001b[?25h");
        if (error) {
          this.output.write("\u001b[2J\u001b[H");
          reject(error);
        } else {
          this.output.write("\u001b[2J\u001b[H");
          const summary = multiple
            ? `${(value as T[]).length} seleccionadas`
            : (options[Number(value)]?.label ?? "seleccionado");
          this.output.write(`${green("✓")} ${prompt}\n  ${summary}\n\n`);
          resolve(value ?? []);
        }
      };
      const onKeypress = (
        _character: string,
        key: { name?: string; ctrl?: boolean },
      ) => {
        if (key.ctrl && key.name === "c")
          return finish(undefined, new WizardCancelledError());
        const active = getActive();
        if (key.name === "up" || key.name === "k") {
          setActive((active + options.length - 1) % options.length);
          render();
        } else if (key.name === "down" || key.name === "j") {
          setActive((active + 1) % options.length);
          render();
        } else if (multiple && (key.name === "space" || key.name === "")) {
          const value = options[active]?.value;
          if (value)
            selected.has(value) ? selected.delete(value) : selected.add(value);
          render();
        } else if (multiple && key.name === "a") {
          options.forEach((option) => {
            selected.add(option.value);
          });
          render();
        } else if (multiple && key.name === "n") {
          selected.clear();
          render();
        } else if (key.name === "return" || key.name === "enter") {
          if (multiple)
            finish(
              options
                .filter((option) => selected.has(option.value))
                .map((option) => option.value),
            );
          else finish(active);
        } else if (key.name === "escape") {
          finish(undefined, new WizardCancelledError());
        }
      };

      input.setRawMode(true);
      input.resume();
      emitKeypressEvents(input);
      input.on("keypress", onKeypress);
      this.output.write("\u001b[?25l");
      render();
    });
  }
}
