import type { InstallScope } from "../runtimes/opencode-installer";
import type { MenuOption } from "../tui";

export const scopeSelectionOptions: MenuOption<InstallScope>[] = [
  {
    value: "global",
    label: "Global",
    description:
      "Disponible desde tus proyectos en todos los runtimes seleccionados.",
  },
  {
    value: "local",
    label: "Solo en este proyecto",
    description:
      "Instala los agentes, skills y configuración solo en el proyecto elegido para los runtimes seleccionados.",
  },
];
