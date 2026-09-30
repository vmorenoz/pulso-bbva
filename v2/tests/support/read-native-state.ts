import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { parseAgentResult } from "../../packages/orchestration/src/protocol/parse";
import type { NativeAttemptEvidence } from "./native-evidence";

type Row = Record<string, unknown>;

const openReadonly = (path: string) => {
  if (!isAbsolute(path)) throw new Error("EVIDENCE_DB_PATH_NOT_ABSOLUTE");
  const db = new Database(resolve(path), { readonly: true, create: false });
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=1000;");
  const queryOnly = db.query("PRAGMA query_only").get() as Row | null;
  if (Number(queryOnly?.query_only) !== 1)
    throw new Error("EVIDENCE_DB_QUERY_ONLY_NOT_ENABLED");
  return db;
};

const requireOne = <T extends Row>(rows: T[], reason: string): T => {
  const row = rows[0];
  if (rows.length !== 1 || !row)
    throw new Error(`${reason}:observed=${rows.length}`);
  return row;
};

const number = (value: unknown) =>
  typeof value === "number" ? value : Number(value);
const optionalText = (value: unknown) =>
  typeof value === "string" ? value : undefined;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const resultHashOf = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

export type ReadNativeStateInput = {
  workDbPath: string;
  runtimeDbPath: string;
  workspaceId: string;
  parentSessionId: string;
  parentCallId?: string;
  delegationId?: string;
  bindingId?: string;
  workId?: string;
};

export type NativeStateSnapshot = {
  workspaceId: string;
  parentSessionId: string;
  calls: Array<{
    parentCallId: string;
    delegationId: string;
    workId: string;
    workItemId: string;
    specialist: string;
    transportPhase: string;
    receiptPhase: string;
    bindingId?: string;
    childSessionId?: string;
    receiptJson?: unknown;
    diagnostic?: unknown;
    attempt?: NativeAttemptEvidence;
    workStatus?: string;
    workItemStatus?: string;
    bindingStatus?: string;
    sideEffectsMayContinue?: boolean;
  }>;
  works: Row[];
  items: Row[];
  currentWorkId?: string;
  sessionWorkIds: string[];
  databaseVersions: { work: number; runtime: number };
};

/** Reads only the two already-created fixture databases; never bootstraps or recovers them. */
export const readNativeState = (
  input: ReadNativeStateInput,
): NativeStateSnapshot => {
  const workDb = openReadonly(input.workDbPath);
  const runtimeDb = openReadonly(input.runtimeDbPath);
  try {
    const before = {
      work: number(
        (workDb.query("PRAGMA data_version").get() as Row | null)?.data_version,
      ),
      runtime: number(
        (runtimeDb.query("PRAGMA data_version").get() as Row | null)
          ?.data_version,
      ),
    };
    const clauses = ["workspace_id = ?", "parent_session_id = ?"];
    const params: (string | number)[] = [
      input.workspaceId,
      input.parentSessionId,
    ];
    if (input.parentCallId) {
      clauses.push("parent_call_id = ?");
      params.push(input.parentCallId);
    }
    if (input.delegationId) {
      clauses.push("delegation_id = ?");
      params.push(input.delegationId);
    }
    const delegations = runtimeDb
      .query(`SELECT * FROM native_delegations WHERE ${clauses.join(" AND ")}`)
      .all(...params) as Row[];
    const calls = delegations.map((delegation) => {
      const delegationId = String(delegation.delegation_id);
      const bindingId = optionalText(delegation.binding_id);
      let attempt: NativeAttemptEvidence | undefined;
      if (bindingId) {
        const bindings = runtimeDb
          .query("SELECT * FROM runtime_bindings WHERE binding_id = ?")
          .all(bindingId) as Row[];
        const binding = requireOne(bindings, `binding:${bindingId}`);
        if (
          binding.runtime_execution_id !== delegationId ||
          binding.runtime_provider !== "opencode" ||
          binding.runtime_session_id !== input.parentSessionId ||
          binding.work_id !== delegation.work_id ||
          binding.work_item_id !== delegation.work_item_id ||
          binding.managed_by !== "opencode-native"
        )
          throw new Error(`EVIDENCE_BINDING_CORRELATION_MISMATCH:${bindingId}`);
        const executionId = optionalText(binding.execution_id);
        const leaseId = optionalText(binding.lease_id);
        if (!executionId || !leaseId)
          throw new Error(`EVIDENCE_BINDING_AUTHORITY_MISSING:${bindingId}`);
        const executions = workDb
          .query(
            "SELECT * FROM work_executions WHERE id = ? AND work_item_id = ?",
          )
          .all(executionId, String(delegation.work_item_id)) as Row[];
        const execution = requireOne(executions, `execution:${executionId}`);
        const leases = workDb
          .query("SELECT * FROM work_leases WHERE id = ? AND execution_id = ?")
          .all(leaseId, executionId) as Row[];
        const lease = requireOne(leases, `lease:${leaseId}`);
        const itemRows = workDb
          .query("SELECT * FROM work_items WHERE id = ? AND work_id = ?")
          .all(
            String(delegation.work_item_id),
            String(delegation.work_id),
          ) as Row[];
        const item = requireOne(
          itemRows,
          `work_item:${delegation.work_item_id}`,
        );
        const workRows = workDb
          .query("SELECT * FROM works WHERE id = ? AND workspace_id = ?")
          .all(String(delegation.work_id), input.workspaceId) as Row[];
        const workRow = requireOne(workRows, `work:${delegation.work_id}`);
        const fencingToken = number(binding.fencing_token);
        let externalExecutionRef: Row | undefined;
        if (typeof execution.external_execution_ref === "string")
          externalExecutionRef = JSON.parse(
            execution.external_execution_ref,
          ) as Row;
        if (
          fencingToken !== number(lease.fencing_token) ||
          lease.execution_id !== executionId ||
          externalExecutionRef?.provider !== "opencode" ||
          externalExecutionRef.id !== delegationId
        )
          throw new Error(
            `EVIDENCE_FENCING_OR_EXECUTION_MISMATCH:${bindingId}`,
          );
        const rawReceipt = optionalText(delegation.receipt_json);
        let receipt: Row | undefined;
        if (rawReceipt) {
          const parsed: unknown = JSON.parse(rawReceipt);
          if (parsed && typeof parsed === "object") receipt = parsed as Row;
        }
        const state =
          receipt?.state && typeof receipt.state === "object"
            ? (receipt.state as Row)
            : undefined;
        const receiptDelegation =
          state?.delegation && typeof state.delegation === "object"
            ? (state.delegation as Row)
            : undefined;
        if (receiptDelegation && "receipt" in receiptDelegation)
          throw new Error(`EVIDENCE_RECEIPT_RECURSIVE:${delegationId}`);
        if (
          String(delegation.receipt_phase) === "applied" &&
          receipt?.accepted === true
        ) {
          const result = receipt.result;
          const parsedResult = parseAgentResult(
            `<pulso-result v="2">${JSON.stringify(result)}</pulso-result>`,
            {
              delegationId,
              specialist: String(delegation.specialist) as
                | "explorer"
                | "planner"
                | "executor"
                | "verifier"
                | "security-auditor",
              workId: String(delegation.work_id),
              workItemId: String(delegation.work_item_id),
            },
          );
          const resultHash = resultHashOf(parsedResult);
          if (
            receipt.protocol !== "pulso-receipt/1" ||
            receipt.resultHash !== resultHash ||
            receipt.receiptHash !== resultHash ||
            delegation.receipt_hash !== resultHash
          )
            throw new Error(
              `EVIDENCE_RECEIPT_HASH_OR_PROTOCOL_MISMATCH:${delegationId}`,
            );
          const authority =
            state?.authority && typeof state.authority === "object"
              ? (state.authority as Row)
              : undefined;
          if (
            !authority ||
            authority.workspaceId !== input.workspaceId ||
            authority.parentSessionId !== input.parentSessionId ||
            authority.parentCallId !== delegation.parent_call_id ||
            authority.childSessionId !== delegation.child_session_id ||
            authority.workId !== delegation.work_id ||
            authority.workItemId !== delegation.work_item_id ||
            authority.bindingId !== bindingId ||
            authority.bindingStatus !== binding.status ||
            authority.executionId !== executionId ||
            authority.executionStatus !== execution.status ||
            authority.leaseId !== leaseId ||
            authority.leaseStatus !== lease.status ||
            number(authority.fencingToken) !== fencingToken
          )
            throw new Error(
              `EVIDENCE_RECEIPT_AUTHORITY_MISMATCH:${delegationId}`,
            );
          if (
            state?.delegation &&
            (state.delegation as Row).sideEffectsMayContinue !== false
          )
            throw new Error(
              `EVIDENCE_RECEIPT_SIDE_EFFECTS_UNCERTAIN:${delegationId}`,
            );
        }
        const diagnostic = delegation.error_json
          ? JSON.parse(String(delegation.error_json))
          : undefined;
        attempt = {
          workspaceId: input.workspaceId,
          parentSessionId: input.parentSessionId,
          parentCallId: String(delegation.parent_call_id ?? ""),
          delegationId,
          workId: String(delegation.work_id),
          workItemId: String(delegation.work_item_id),
          specialist: String(delegation.specialist),
          childSessionId: optionalText(delegation.child_session_id),
          bindingId,
          receiptPhase: String(delegation.receipt_phase),
          accepted:
            typeof receipt?.accepted === "boolean"
              ? receipt.accepted
              : undefined,
          resultHash: optionalText(delegation.receipt_hash),
          receiptHash: optionalText(receipt?.receiptHash),
          authority: {
            executionId,
            executionStatus: String(execution.status),
            leaseId,
            leaseStatus: String(lease.status),
            fencingToken,
          },
          ...(diagnostic && typeof diagnostic === "object"
            ? { diagnostic: diagnostic as { code: string; stage?: string } }
            : {}),
          workItemStatus: String(item.status),
          bindingStatus: String(binding.status),
          workStatus: String(workRow.status),
          sideEffectsMayContinue:
            delegation.side_effects_may_continue === 1 ||
            delegation.side_effects_may_continue === true,
        } as NativeAttemptEvidence;
      }
      return {
        parentCallId: String(delegation.parent_call_id ?? ""),
        delegationId,
        workId: String(delegation.work_id),
        workItemId: String(delegation.work_item_id),
        specialist: String(delegation.specialist),
        transportPhase: String(delegation.transport_phase),
        receiptPhase: String(delegation.receipt_phase),
        sideEffectsMayContinue:
          delegation.side_effects_may_continue === 1 ||
          delegation.side_effects_may_continue === true,
        ...(bindingId ? { bindingId } : {}),
        ...(optionalText(delegation.child_session_id)
          ? { childSessionId: String(delegation.child_session_id) }
          : {}),
        ...(delegation.receipt_json
          ? { receiptJson: JSON.parse(String(delegation.receipt_json)) }
          : {}),
        ...(delegation.error_json
          ? { diagnostic: JSON.parse(String(delegation.error_json)) }
          : {}),
        ...(bindingId
          ? {
              workStatus: String(
                (
                  workDb
                    .query(
                      "SELECT status FROM works WHERE id=? AND workspace_id=?",
                    )
                    .get(
                      String(delegation.work_id),
                      input.workspaceId,
                    ) as Row | null
                )?.status ?? "not-observed",
              ),
            }
          : {}),
        ...(bindingId
          ? {
              bindingStatus: String(
                (
                  runtimeDb
                    .query(
                      "SELECT status FROM runtime_bindings WHERE binding_id=?",
                    )
                    .get(bindingId) as Row
                ).status,
              ),
            }
          : {}),
        ...(attempt ? { attempt } : {}),
      };
    });
    const current = runtimeDb
      .query(
        "SELECT work_id FROM native_current_work WHERE workspace_id = ? AND parent_session_id = ?",
      )
      .get(input.workspaceId, input.parentSessionId) as Row | null;
    const sessionWorkIds = (
      runtimeDb
        .query(
          "SELECT work_id FROM native_session_works WHERE workspace_id = ? AND parent_session_id = ? ORDER BY associated_at",
        )
        .all(input.workspaceId, input.parentSessionId) as Row[]
    ).map((row) => String(row.work_id));
    const workIds = [
      ...new Set([
        ...calls.map((call) => call.workId),
        ...sessionWorkIds,
        ...(current ? [String(current.work_id)] : []),
        ...(input.workId ? [input.workId] : []),
      ]),
    ];
    const works: Row[] = [];
    const items: Row[] = [];
    for (const workId of workIds) {
      const rows = workDb
        .query("SELECT * FROM works WHERE id = ? AND workspace_id = ?")
        .all(workId, input.workspaceId) as Row[];
      works.push(...rows);
      items.push(
        ...(workDb
          .query("SELECT * FROM work_items WHERE work_id = ?")
          .all(workId) as Row[]),
      );
    }
    const after = {
      work: number(
        (workDb.query("PRAGMA data_version").get() as Row | null)?.data_version,
      ),
      runtime: number(
        (runtimeDb.query("PRAGMA data_version").get() as Row | null)
          ?.data_version,
      ),
    };
    if (before.work !== after.work || before.runtime !== after.runtime)
      throw new Error("EVIDENCE_DATABASE_CHANGED_DURING_CAPTURE");
    return {
      workspaceId: input.workspaceId,
      parentSessionId: input.parentSessionId,
      calls,
      works,
      items,
      ...(current ? { currentWorkId: String(current.work_id) } : {}),
      sessionWorkIds,
      databaseVersions: after,
    };
  } finally {
    runtimeDb.close();
    workDb.close();
  }
};
