const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');

// Injection is for isolated tests; activation uses the public VS Code API only.
async function activateWith(vscode, context, {homeDir = os.homedir()} = {}) {
  const [{toolDefinitions, createPulsoTools, validateToolInput, isMutating}, {createWorkspaceResolver}] = await Promise.all([
    import(pathToFileURL(path.join(__dirname, 'tools.mjs')).href),
    import(pathToFileURL(path.join(__dirname, 'workspace.mjs')).href),
  ]);
  const coreDir = path.join(context.extensionPath, 'resources', 'lib');
  const project = createWorkspaceResolver(vscode);
  for (const definition of toolDefinitions) {
    context.subscriptions.push(vscode.lm.registerTool(definition.name, {
      prepareInvocation(options) {
        validateToolInput(definition, options?.input);
        return {invocationMessage: `${definition.displayName} · ${options.input.action || 'consulta'}`};
      },
      async invoke(options, token) {
        validateToolInput(definition, options?.input);
        // Single-folder windows need no selection; multi-root windows retain
        // one explicit binding until the user switches or folders change.
        const root = await project.resolve({token, toolName: definition.name, action: options.input.action});
        const bindingId = project.bindingId(root, token);
        const assertContext = () => {
          project.assertRoot(root, token);
          if (isMutating(definition.name, options.input)) project.assertBinding(root, options.input.expectedBindingId, token);
        };
        const tools = await createPulsoTools({coreDir, homeDir, assertContext});
        const receipt = await tools[definition.name].execute(options.input, root);
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(JSON.stringify({
            ...receipt, workspace: root, bindingId,
          })),
        ]);
      },
    }));
  }
  context.subscriptions.push(vscode.commands.registerCommand('pulso.openChat', async () => {
    await vscode.commands.executeCommand('workbench.action.chat.open');
    await vscode.window.showInformationMessage('Selecciona Pulso en el selector de agentes y Local o Copilot como destino de sesión.');
  }));
  context.subscriptions.push(vscode.commands.registerCommand('pulso.selectProject', async () => {
    try {
      const root = await project.select({toolName: 'Pulso'});
      await vscode.window.showInformationMessage(`Pulso · Proyecto activo: ${root}`);
    } catch (error) {
      if (!String(error.message).includes('cancelled')) throw error;
    }
  }));
}

exports.activateWith = activateWith;
exports.activate = context => activateWith(require('vscode'), context);
exports.deactivate = () => {};

