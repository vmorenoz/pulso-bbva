---
description: Discover, interview, and connect external OpenCode agents to Pulso's global address book.
agent: pulso
---

Manage Pulso agent contacts interactively. This is configuration work: do not create an objective, task state, metrics, or experience closure.

1. Call `pulso_agent_contacts` with `action: scan` and compare candidates by their `registration` state.
2. Use the native question tool to let the user select one or more compatible new or changed agents. Explain why primary-only agents cannot be delegated. Also offer listing or removing existing contacts when relevant.
3. For every selected candidate, delegate a visible native task to that exact agent with `PULSO_CONTACT_PROBE=<agent-name>`. Ask it only to describe its purpose, use cases, non-use cases, capabilities, and whether it needs mutation. It must not use tools, edit files, execute commands, or delegate.
4. Reconcile the interview with the scanned description and mutation hint. Present a concise proposed contact card and ask the user to approve it or choose read-only versus scoped mutation when unclear. Explain that contacts cannot use shell or delegate other agents; implementation requiring those capabilities remains with Pulso Executor.
5. Register only approved cards using the exact digest returned by scan.
6. Report what was connected, when Pulso will use it, and one realistic example. Mention that changed agent definitions require running this command again.

Never register an agent silently, infer approval, expose full prompts, or use an external agent that is not present in the scan results.
