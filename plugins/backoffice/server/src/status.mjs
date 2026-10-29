// Traduce un evento de hook de Claude a un estado de sesión.
// working = Claude está produciendo o usando herramientas
// waiting = necesita a una persona (permiso o aviso)
// idle    = terminó su turno
export function stateFromEvent(event, p = {}) {
  switch (event) {
    case 'SessionStart':
      return { status: 'idle', detail: 'Sesión iniciada' }
    case 'UserPromptSubmit':
      return { status: 'working', tool: null, detail: 'Pensando' }
    case 'PreToolUse':
      // Claude le hace una pregunta a la persona: queda esperando respuesta.
      if (p.tool_name === 'AskUserQuestion') return { status: 'waiting', tool: 'AskUserQuestion', detail: 'Tiene una pregunta para ti' }
      return { status: 'working', tool: p.tool_name ?? null, detail: describeTool(p) }
    case 'PostToolUse':
      return { status: 'working', tool: p.tool_name ?? null, detail: 'Siguiendo' }
    case 'PermissionRequest':
      return { status: 'waiting', tool: p.tool_name ?? null, detail: `Pide permiso: ${p.tool_name ?? 'herramienta'}` }
    case 'Notification':
      return { status: 'waiting', detail: p.message ?? 'Necesita atención' }
    case 'Stop':
      return { status: 'idle', tool: null, detail: 'Listo' }
    case 'StopFailure':
      return { status: 'error', tool: null, detail: 'Falló el turno' }
    case 'SessionEnd':
      return { status: 'offline', tool: null, detail: 'Sesión cerrada' }
    default:
      return null // SubagentStart/Stop y demás no cambian el estado
  }
}

function describeTool(p) {
  const i = p.tool_input ?? {}
  const target = i.file_path ?? i.path ?? i.command ?? i.url ?? i.pattern ?? ''
  const short = String(target).slice(0, 80)
  return short ? `${p.tool_name}: ${short}` : String(p.tool_name ?? 'Herramienta')
}

export const projectName = (cwd) => (cwd ? cwd.split('/').filter(Boolean).pop() : null)
