// E08 offline acceptance reuses the product-owned behavioral suites and APIs.
// These imports execute their deterministic tests under the scoped command.
import "../../packages/capabilities-mcp/test/context-forwarding.regression.test";
import "../../packages/working-system/test/evolution-graph.test";
import "../../packages/capabilities-mcp/test/evolution-reservations.test";
import "../../packages/capabilities-mcp/test/evolution-effect-guard.test";
import "../../packages/capabilities-mcp/test/evolution-preferences.test";
import "../../packages/capabilities-mcp/test/opencode-work.test";
import "../../packages/capabilities-mcp/test/opencode-delegation.test";
import "../../packages/capabilities-mcp/test/opencode-reference-dispatch.test";
import "../../packages/capabilities-mcp/test/evolution-artifacts.test";
import "../../packages/capabilities-mcp/test/evolution-capabilities.test";
import "../../packages/capabilities-mcp/test/evolution-facade.test";
import "../../packages/capabilities-mcp/test/evolution-presenter.test";
import "../../packages/orchestration/test/decision-kernel.test";
import "../../packages/orchestration/test/evolution-plan-readiness.test";
import "../../packages/orchestration/test/evolution-schema-parity.test";
import "../../packages/working-system/test/sqlite.test";
