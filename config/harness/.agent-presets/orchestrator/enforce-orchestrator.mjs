// Orchestrator hard-enforcement for the `orchestrator` (分解委派) preset.
//
// This row walks the `tools/pre-execute` waterfall and REJECTS the "do-work"
// tools when the CALLING agent is the ROOT orchestrator dialog (agentPreset ===
// 'orchestrator', delegationDepth === 0). The main dialog is therefore prevented
// from performing subtask work inline; it may only decompose, dispatch to fresh
// worker dialogs (subagent / subagent_fork / workflow), and summarize. Workers
// (delegationDepth >= 1) keep the full tool set, and every other mode is
// unaffected.
//
// It publishes no service and injects nothing, so it sits loose in the preset and
// mounts once per standing scope, listening to the tool calls of every agent that
// joins the preset.
export default {
  name: 'orchestrator-enforce',

  apply(ctx) {
    // Tools the ORCHESTRATOR main dialog is forbidden to use. THIS LIST is the
    // single source of truth: the persona's "Hard prohibitions" names only the
    // categories and tells the model to follow the deny error, so a new work
    // tool needs a change here and nowhere else.
    const DENIED = [
      'read', 'write', 'edit', 'glob', 'grep',
      'pwsh', 'bash', 'run_code',
      'web_search', 'web_fetch', 'read_image', 'modlens_read_image',
    ]
    const denySet = new Set(DENIED)

    function headerOf(agent) {
      try {
        return agent && agent.session && agent.session.header
      } catch {
        return undefined
      }
    }

    ctx.on('tools/pre-execute', async (exec, next) => {
      if (!denySet.has(exec.name)) return next()
      const agent = exec.agent
      const h = headerOf(agent)
      if (!h) return next()
      const isOrchestrator = h.agentPreset === 'orchestrator'
      const depth = typeof h.delegationDepth === 'number' ? h.delegationDepth : 0
      if (isOrchestrator && depth === 0) {
        return {
          kind: 'deny',
          reason:
            'This dialog is the ORCHESTRATOR: it may not call "' + exec.name +
            '" itself. Decompose the task and dispatch this subtask to a fresh worker ' +
            'via subagent/subagent_fork/workflow, then read only its summarized result.',
        }
      }
      return next()
    })
  },
}
