const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');

// Test injection supplies the same public host API used during activation.
async function activateWith(vscode, context, {homeDir = os.homedir()} = {}) {
  const resourceRoot = path.join(context.extensionPath, 'resources');
  // Identify the loaded extension package, not the checkout or a build constant.
  const loadedPackage = JSON.parse(fs.readFileSync(path.join(context.extensionPath, 'package.json'), 'utf8'));
  const provenance = {runtime: {adapter: 'vscode', packageName: loadedPackage.name, version: loadedPackage.version}};
  const load = file => import(pathToFileURL(file).href);
  const [{toolDefinitions, validateToolInput, isMutating}, {executeTool}, {createWorkspaceResolver}, {unwrapInput, requiresBinding}] = await Promise.all([
    load(path.join(resourceRoot, 'lib/tool-contracts.mjs')),
    load(path.join(resourceRoot, 'lib/semantic-tools.mjs')),
    load(path.join(__dirname, 'workspace.mjs')),
    load(path.join(__dirname, 'native-contracts.mjs')),
  ]);
  const project = createWorkspaceResolver(vscode);
  context.subscriptions.push(project);
  for (const definition of toolDefinitions) {
    context.subscriptions.push(vscode.lm.registerTool(definition.name, {
      prepareInvocation(options) {
        const {semantic} = unwrapInput(definition, options?.input, validateToolInput);
        const message = `${definition.displayName} · ${semantic.action || 'consulta'}`;
        return {invocationMessage: message, ...(isMutating(definition.name, semantic) ? {
          confirmationMessages: {title: message, message: 'Aplicar esta operación de metadatos en el proyecto vinculado de Pulso. Las preferencias de scope=user afectan también a futuros proyectos.'},
        } : {})};
      },
      async invoke(options, token) {
        const {semantic, expectedBindingId} = unwrapInput(definition, options?.input, validateToolInput);
        const bound = await project.resolveContext({token, toolName: definition.name, action: semantic.action});
        const {root, bindingId, generation} = bound;
        const assertContext = () => {
          project.assertContext(bound, token);
          if (requiresBinding(definition.name, semantic) || expectedBindingId !== undefined || isMutating(definition.name, semantic)) project.assertBinding(root, expectedBindingId, token);
        };
        // Native approval and root binding are separate. The public API exposes
        // no authenticated caller-agent or session cwd; do not invent either.
        assertContext();
        const receipt = await executeTool(definition.name, semantic, {projectRoot: root, homeDir, resourceRoot, assertContext});
        try { assertContext(); }
        catch (error) {
          // Preserve committed/partial data if context changes after an await.
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify({
            ...receipt, ok: false, output: `${receipt.output}\nContext changed after invocation: ${error.message}`,
            contextChanged: true, workspace: root, bindingId, generation, provenance,
          }))]);
        }
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify({...receipt, workspace: root, bindingId, generation, provenance}))]);
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
    } catch (error) { if (!String(error.message).includes('cancelled')) throw error; }
  }));
}
exports.activateWith = activateWith;
exports.activate = context => activateWith(require('vscode'), context);
exports.deactivate = () => {};
