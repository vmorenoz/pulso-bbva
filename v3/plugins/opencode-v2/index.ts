import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import { pathToFileURL } from "node:url"

const pulsoRoot = path.join(os.homedir(), ".pulso", "lib")
const core = async (name: string) => import(pathToFileURL(path.join(pulsoRoot, name)).href)
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object", properties, required, additionalProperties: false,
})
const string = (description: string, maxLength = 4000) => ({ type: "string", description, maxLength })
const id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$" }
const list = (items: unknown, maxItems = 50) => ({ type: "array", items, maxItems })
const updateSchema = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".pulso", "schemas", "work-update.schema.json"), "utf8"))
const actionSchema = updateSchema.properties.actions.items

export default {
  id: "pulso",
  async setup(ctx: any) {
    const register = (editor: any, name: string, description: string, input: unknown, run: (args: any, root: string) => Promise<string>) => {
      editor.add({ name, description, input, async execute(args: any, context: { sessionID: string; signal: AbortSignal }) {
        try {
          if (!context?.sessionID) throw new Error("OpenCode no proporcionó la sesión actual; no se modificó ningún archivo.")
          const session = await ctx.session.get({ sessionID: context.sessionID })
          const activeDirectory = session.location?.directory
          if (!activeDirectory) throw new Error("OpenCode no proporcionó el directorio de esta sesión; no se modificó ningún archivo.")
          return { content: await run(args, path.resolve(activeDirectory)) }
        }
        catch (error) { return { content: `No se completó ${name}: ${(error as Error).message}` } }
      } })
    }
    await ctx.tool.transform((editor: any) => {
      register(editor, "pulso_workspace_prepare", "Inicializa el espacio Pulso del workspace activo; conserva cualquier dato existente.", object({}, []), async (_args, root) => {
        const { prepareWorkspace } = await core("workspace.mjs");
        const result = prepareWorkspace(root)
        return result.existingWorkspace ? "Pulso ya estaba preparado; no se modificaron los datos existentes." : "✓ Pulso preparó el workspace con estado, historial y documentos base."
      })
      register(editor, "pulso_status", "Consulta el índice compacto del workspace actual, sin recorrer trabajos.", object({}, []), async (_args, root) => {
        if (!fs.existsSync(path.join(root, ".pulso", "state.json"))) return "Pulso no está preparado en este workspace; prepara solo si existe un encargo concreto."
        const { readStatus } = await core("work-mutations.mjs"); const s = readStatus(root)
        const focus = s.works.find((w: any) => w.id === s.focusWorkId)
        return focus ? `Pulso · ${focus.id} ${focus.status} · ${focus.progress.done}/${focus.progress.total}\n${focus.objective}\nSiguiente: ${focus.nextAction || "sin acción registrada"}` : `Pulso · ${s.works.length} trabajos abiertos · sin foco${s.works.length ? `\n${s.works.slice(0, 10).map((w: any) => `${w.id} ${w.status} · ${w.lastProgress}`).join("\n")}${s.works.length > 10 ? `\n… y ${s.works.length - 10} más` : ""}` : ""}`
      })
      register(editor, "pulso_work_get", "Lee un Work y devuelve solo sus metadatos de coordinación.", object({ workId: id }, ["workId"]), async ({ workId }, root) => {
        const { readWork } = await core("artifacts.mjs"); const w = readWork(root, workId, { files: false })
        const criteria = w.objective.criteria.slice(0, 12).map((c: any) => `${c.id}: ${c.description.slice(0, 220)} · verificar: ${c.verification.slice(0, 160)}`).join("\n")
        const tasks = w.tasks.slice(0, 20).map((t: any) => `${t.id} [${t.status}] ${t.title.slice(0, 160)}${t.summary ? ` — ${t.summary.slice(0, 220)}` : ""}`).join("\n")
        const blockers = w.blockers.slice(0, 8).map((value: string) => value.slice(0, 180)).join("; ") || "ninguno"
        const omitted = `${w.objective.criteria.length > 12 ? ` · ${w.objective.criteria.length - 12} criterios omitidos` : ""}${w.tasks.length > 20 ? ` · ${w.tasks.length - 20} tareas omitidas` : ""}`
        return `${w.id} · revisión ${w.revision} · ${w.status}\n${w.title}: ${w.objective.outcome.slice(0, 400)}\nCriterios:\n${criteria || "sin criterios"}\nTareas (${w.tasks.filter((t: any) => t.status === "done").length}/${w.tasks.length}):\n${tasks || "sin tareas"}${omitted}\nBloqueos: ${blockers}\nSiguiente: ${w.nextAction || "sin acción registrada"}`
      })
      register(editor, "pulso_work_create", "Crea un trabajo Pulso con objetivo, criterio verificable y prioridad.", object({ workId: id, title: string("Título", 240), objective: string("Resultado esperado"), criterion: string("Criterio de aceptación"), verification: string("Método de verificación"), priority: { enum: ["low", "normal", "high", "urgent"] } }, ["workId", "title", "objective", "criterion", "verification"]), async (args, root) => {
        const { createWorkOperation } = await core("work-mutations.mjs"); const { formatReceipt } = await core("receipts.mjs"); return formatReceipt(createWorkOperation(root, args))
      })
      register(editor, "pulso_work_apply", "Aplica hasta 20 cambios semánticos en una sola revisión de Work. No acepta JSON completo.", object({ workId: id, expectedRevision: { type: "integer", minimum: 1 }, actions: list(actionSchema, 20) }, ["workId", "expectedRevision", "actions"]), async (args, root) => {
        const { applyWorkMutation } = await core("work-mutations.mjs"); const { formatReceipt } = await core("receipts.mjs"); return formatReceipt(applyWorkMutation(root, args))
      })
      register(editor, "pulso_work_close", "Cierra un Work tras validar evidencia positiva y revisión vigente.", object({ workId: id, expectedRevision: { type: "integer", minimum: 1 }, outcome: { enum: ["done", "cancelled"] }, summary: string("Resultado o motivo"), limitations: list(string("Limitación", 1000), 30) }, ["workId", "expectedRevision", "summary"]), async (args, root) => {
        const { closeWorkOperation } = await core("work-mutations.mjs"); const { formatReceipt } = await core("receipts.mjs"); return formatReceipt(closeWorkOperation(root, args))
      })
      register(editor, "pulso_work_reopen", "Reabre un Work cerrado con motivo y nueva revisión de ciclo.", object({ workId: id, expectedRevision: { type: "integer", minimum: 1 }, reason: string("Motivo") }, ["workId", "expectedRevision", "reason"]), async (args, root) => {
        const { reopenWorkOperation } = await core("work-mutations.mjs"); const { formatReceipt } = await core("receipts.mjs"); return formatReceipt(reopenWorkOperation(root, args))
      })
      register(editor, "pulso_history", "Consulta cierres por Work o por fechas ISO; resultado limitado.", object({ workId: id, since: { type: "string", format: "date-time" }, until: { type: "string", format: "date-time" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, []), async (args, root) => {
        const { readHistory } = await core("work-mutations.mjs"); const entries = readHistory(root, args)
        return entries.length ? entries.map((e: any) => `${e.workId} · ${e.outcome} · ${e.closedAt}\n${e.summary.slice(0, 320)}`).join("\n\n") : "No hay cierres para esa consulta."
      })
      register(editor, "pulso_work_validate", "Valida coherencia canónica y, opcionalmente, vigencia de evidencia del proyecto.", object({ fresh: { type: "boolean" } }, []), async ({ fresh = false }, root) => {
        const { validateWorkspace } = await core("work-mutations.mjs"); const result = validateWorkspace(root, { fresh }); return `✓ Pulso válido · ${result.works} trabajos · ${result.closures} cierres${fresh ? " · evidencia vigente comprobada" : ""}`
      })
      register(editor, "pulso_project_complete_map", "Registra y cierra el Work reservado al mapeo inicial del proyecto.", object({ workId: id, expectedRevision: { type: "integer", minimum: 1 }, summary: string("Resumen verificado"), limitations: list(string("Limitación", 1000), 30) }, ["workId", "expectedRevision", "summary"]), async (args, root) => {
        const { completeMapOperation } = await core("work-mutations.mjs"); const result = completeMapOperation(root, args); return `✓ ${result.id} mapeado y cerrado · revisión ${result.revision} · evidencia ${result.evidenceId}`
      })
    })
  },
}
