"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Office from "@/components/Office";
import TeamHud from "@/components/TeamHud";
import KanbanBoard from "@/components/KanbanBoard";
import Header from "@/components/Header";
import ProjectHome from "@/components/ProjectHome";
import { buildTeamSeats, type Seat } from "@/lib/team";
import { COO_AGENT, findAgent } from "@/lib/roster";
import { AVATAR_PALETTES } from "@/components/office/officeLayout";
import { getJson, post, useBackOffice } from "@/lib/useBackOffice";
import { newConversationLink, resumeCommand, sessionLink } from "@/lib/claude";
import { STATUS_LABEL } from "@/lib/team";
import { useOfficeView } from "@/lib/officeViewContext";
import type { Conn } from "@/lib/useBackOffice";

/** Contadores del inicio (los mismos en la vista 2D y en la oficina 3D). */
function StatusPills({
  active,
  waiting,
  pending,
  conn,
}: {
  active: number;
  waiting: number;
  pending: number;
  conn: Conn;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-surface/85 px-3 py-1 font-semibold text-ink">
        <b className="text-blue">{active}</b> trabajando
      </span>
      <span className="rounded-full bg-surface/85 px-3 py-1 font-semibold text-ink">
        <b className="text-amber">{waiting}</b> te esperan
      </span>
      <span className="rounded-full bg-surface/85 px-3 py-1 font-semibold text-ink">
        <b className="text-orange">{pending}</b> por revisar
      </span>
      <span className="flex items-center gap-1.5 rounded-full bg-surface/85 px-3 py-1 font-semibold text-ink">
        <span
          className={`h-2 w-2 rounded-full ${conn === "live" ? "bg-teal" : conn === "connecting" ? "bg-amber" : "bg-red"}`}
        />
        {conn === "live"
          ? "En vivo"
          : conn === "connecting"
            ? "Conectando"
            : "Sin conexión"}
      </span>
    </div>
  );
}

export default function Page() {
  const { sessions, tasks, teams, coo, conn, workspace, workspaceId } =
    useBackOffice();
  // La oficina 3D es opcional (interruptor «Vista oficina» del navbar); por defecto el inicio es el canvas del proyecto.
  const { officeView } = useOfficeView();
  const [pad, setPad] = useState(0);
  useEffect(() => {
    setPad(
      Number(new URLSearchParams(window.location.search).get("equipo")) || 0,
    );
  }, []);
  // La oficina muestra todos los equipos de la empresa, cada uno en su isla; sin equipos, solo la COO.
  const orderedTeams = useMemo(
    () => teams,
    [teams],
  );
  const teamMembers = useMemo(
    () =>
      orderedTeams.map((t) => ({
        id: t.id,
        members: t.members.flatMap((m) => {
          const a = findAgent(m.agent_id);
          if (!a) return [];
          const face = m.avatar ?? a.face;
          return [
            {
              ...a,
              face,
              color:
                m.avatar != null ? AVATAR_PALETTES[m.avatar].shirt : a.color,
              name: m.display_name.trim() || a.name,
            },
          ];
        }),
      })),
    [orderedTeams],
  );
  // Miembro de servidor (con su session_ref) de cada asiento, por llave `${equipo}:${agente}`.
  const memberOf = (key: string) => {
    const i = key.indexOf(":");
    return i < 0
      ? undefined
      : teams
          .find((t) => t.id === key.slice(0, i))
          ?.members.find((x) => x.agent_id === key.slice(i + 1));
  };
  // El COO es el agente por defecto: siempre está, con su nombre, avatar y oficina.
  const cooMember = useMemo(() => {
    const face = coo?.avatar ?? COO_AGENT.face;
    return {
      ...COO_AGENT,
      face,
      color:
        coo?.avatar != null
          ? AVATAR_PALETTES[coo.avatar].shirt
          : COO_AGENT.color,
      name: coo?.display_name.trim() || COO_AGENT.name,
    };
  }, [coo]);
  const { seats: rawSeats, teamSizes } = useMemo(
    () => buildTeamSeats(sessions, teamMembers, pad, cooMember),
    [sessions, teamMembers, pad, cooMember],
  );
  const teamNames = useMemo(
    () => [
      ...orderedTeams.map((t) => t.name),
      ...(teamSizes.length > orderedTeams.length ? ["Vista previa"] : []),
    ],
    [orderedTeams, teamSizes],
  );
  // Con conversación vinculada el agente está presente: sentado en su escritorio («Libre») aunque no haya sesión viva.
  const seats = useMemo(
    () =>
      rawSeats.map((s) => {
        const m = s.key === "coo" ? coo : memberOf(s.key);
        return s.status === "offline" && sessionLink(m?.session_ref)
          ? { ...s, status: "idle" as const }
          : s;
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }),
    [rawSeats, coo, teams],
  );
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Pantalla del tablero de tareas dentro del juego: se abre con E junto al tablero, al tocar una nota o con el botón.
  const [boardForced, setBoardForced] = useState(false);
  const closeBoard = () => setBoardForced(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBoardForced(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const boardOpen = boardForced;
  const openTask = (id: string) => {
    setSelectedTask(id);
    setBoardForced(true);
  };
  // Conversación ya existente del agente (session_ref) si es válida. Si no, una nueva con el saludo prellenado
  // («Hola, ahora eres un … llamado …») para que la persona la empiece y copie su id al panel de Equipos:
  // los agentes en Cowork, Assistant en Claude Code; ambas en la carpeta del proyecto.
  const openLink = (s: Seat) => {
    const isCoo = s.key === "coo";
    const m = isCoo ? coo : memberOf(s.key);
    const linked = sessionLink(m?.session_ref)?.url;
    if (linked) return linked;
    return newConversationLink({
      surface: isCoo ? "code" : "cowork",
      role: isCoo
        ? "asistente"
        : (findAgent(s.member.id)?.name ?? s.member.role),
      name: m?.display_name,
      female: isCoo,
      folder: workspace?.root,
    });
  };
  const refOf = (s: Seat) =>
    (s.key === "coo" ? coo : memberOf(s.key))?.session_ref;
  const isCodex = (s: Seat) => sessionLink(refOf(s))?.kind === "codex";
  const isCowork = (s: Seat) => sessionLink(refOf(s))?.kind === "cowork";
  const codexKeys = seats.filter(isCodex).map((s) => s.key);
  const coworkKeys = seats.filter(isCowork).map((s) => s.key);
  // Título y carpeta de las tareas de Cowork ligadas: Desktop no las abre por enlace, así que se dice cuál buscar.
  const [coworkInfo, setCoworkInfo] = useState<
    Record<string, { title: string; cwd: string }>
  >({});
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!coworkKeys.length) return;
    getJson("/api/desktop/code-sessions")
      .then(
        (d: {
          sessions: {
            id: string;
            title: string;
            cwd: string;
            surface?: string;
          }[];
        }) =>
          setCoworkInfo(
            Object.fromEntries(
              d.sessions
                .filter((x) => x.surface === "cowork")
                .map((x) => [`cowork:${x.id}`, { title: x.title, cwd: x.cwd }]),
            ),
          ),
      )
      .catch(() => {});
  }, [coworkKeys.join()]);
  const hasSession = (s: Seat) =>
    !!sessionLink((s.key === "coo" ? coo : memberOf(s.key))?.session_ref);
  // E junto a un personaje (o clic en él): abre la conversación en Claude Desktop y deja el aviso con el comando de respaldo.
  const talkTo = (key: string) => {
    const s = seats.find((x) => x.key === key);
    if (!s) return;
    setSelectedSeat(key);
    if (isCowork(s)) {
      const info = coworkInfo[refOf(s) ?? ""];
      setNotice(
        `${s.member.name} trabaja en una tarea de Cowork${info ? ` «${info.title || "Sin título"}»${info.cwd ? ` (${info.cwd.split(/[\\/]/).filter(Boolean).pop()})` : ""}` : ""}. Claude Desktop no permite abrir tareas de Cowork por enlace: te traigo Claude al frente; ábrela en la barra lateral de Cowork.`,
      );
      setTimeout(() => setNotice(null), 12000);
    }
    window.location.href = openLink(s);
  };
  const onInteract = (id: string) => {
    if (id === "board") setBoardForced(true);
    else if (id === "assistant") talkTo("coo");
    else if (id.startsWith("agent:")) talkTo(id.slice(6));
  };
  const seat = seats.find((x) => x.key === selectedSeat) ?? null;
  const resume = seat ? resumeCommand(seat) : null;
  const active = seats.filter((s) => s.status === "working").length;
  const waiting = seats.filter((s) => s.status === "waiting").length;
  const pending = tasks.filter((t) => t.status === "review").length;

  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-6 sm:px-6">
      <Header conn={conn} />

      {conn === "down" && (
        <div className="card border-amber p-4 text-sm">
          No encuentro el servidor de Back Office. Se enciende solo al abrir una
          sesión de Claude con el plugin instalado, o corre{" "}
          <code className="font-mono text-xs">
            node plugins/backoffice/server/src/server.mjs
          </code>
          .
        </div>
      )}

      {conn === "live" && teams.length === 0 && (
        <div
          role="note"
          className="card flex flex-wrap items-center justify-between gap-3 border-blue bg-blue-soft/60 px-4 py-3"
        >
          <p className="text-sm">
            <span className="font-semibold">
              Todavía no hay equipos en {workspace?.name ?? workspaceId}.
            </span>{" "}
            {officeView ? (
              <>
                Solo está {cooMember.name}, en la recepción; crea un equipo para
                verlo trabajar en la oficina.
              </>
            ) : (
              <>
                Solo está {cooMember.name}; crea un equipo para verlo trabajar
                aquí.
              </>
            )}
          </p>
          <Link
            href="/equipos"
            className="rounded-full bg-blue px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            Crear mi primer equipo
          </Link>
        </div>
      )}

      {officeView ? (
        <section className="card overflow-hidden">
          <div className="relative h-[calc(100vh-205px)] min-h-[440px]">
            <Office
              projectName={workspace?.name ?? workspaceId}
              seats={seats}
              teams={teamNames.map((name, i) => ({ name, size: teamSizes[i] }))}
              tasks={tasks}
              selectedTask={selectedTask}
              onSelectTask={openTask}
              selectedSeat={selectedSeat}
              onSelectSeat={setSelectedSeat}
              onInteract={onInteract}
              codexKeys={codexKeys}
              coworkKeys={coworkKeys}
            />
            {boardOpen && (
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/20 p-3"
                style={{ zIndex: 2147483100 }}
              >
                <div
                  role="dialog"
                  aria-label="Tablero de tareas"
                  className="pointer-events-auto flex max-h-full w-[min(1280px,100%)] flex-col overflow-hidden rounded-sm border-2 border-[#7A4E2D] bg-[#D9A86C] shadow-none"
                >
                  <div className="flex items-center justify-between gap-3 bg-[#7A4E2D] px-4 py-2 text-white">
                    <div>
                      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
                        Pared de tareas
                      </div>
                      <div className="text-sm font-extrabold">
                        Tablero de tareas
                      </div>
                    </div>
                    <button
                      className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold hover:bg-white/25"
                      onClick={closeBoard}
                    >
                      Cerrar · Esc
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto bg-bg p-3">
                    <KanbanBoard tasks={tasks} />
                  </div>
                </div>
              </div>
            )}
            <div
              className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-23rem)] flex-col gap-1.5"
              style={{ zIndex: 2147483000 }}
              aria-label="Estado de la oficina"
            >
              <StatusPills
                active={active}
                waiting={waiting}
                pending={pending}
                conn={conn}
              />
            </div>
            <div
              className="absolute bottom-3 left-3 flex max-h-[calc(100%-4.5rem)] w-[min(260px,46%)]"
              style={{ zIndex: 2147483000 }}
            >
              <TeamHud
                seats={seats}
                selectedKey={selectedSeat}
                onOpen={talkTo}
                linked={hasSession}
                codexKeys={codexKeys}
                coworkKeys={coworkKeys}
              />
            </div>
            {seat && (
              <div
                className="absolute bottom-3 right-3 flex justify-end"
                style={{ zIndex: 2147483000 }}
              >
                <div className="flex max-w-full flex-wrap items-center gap-3 rounded-full border border-line bg-ink px-4 py-2 text-xs text-bg">
                  <span className="font-semibold">{seat.member.name}</span>
                  <span className="text-bg/60">
                    {STATUS_LABEL[seat.status]}
                  </span>
                  <a
                    href={openLink(seat)}
                    className="rounded-full bg-blue px-3 py-1 font-semibold text-white hover:opacity-90"
                  >
                    {hasSession(seat)
                      ? isCodex(seat)
                        ? "Abrir su conversación en Codex"
                        : isCowork(seat)
                          ? "Ir a su tarea en Cowork"
                          : "Abrir su conversación"
                      : seat.key === "coo"
                        ? "Nueva sesión de Code"
                        : "Nueva conversación en Cowork"}
                  </a>
                  {resume && (
                    <button
                      className="rounded-full bg-bg/15 px-3 py-1 font-semibold hover:bg-bg/25"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(resume)
                          .then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          })
                          .catch(() => {})
                      }
                    >
                      {copied ? "Copiado" : "Copiar comando para retomar"}
                    </button>
                  )}
                  {findAgent(seat.member.id) && (
                    <Link
                      href={`/canvas?agent=${encodeURIComponent(seat.member.id)}`}
                      className="rounded-full bg-bg/15 px-3 py-1 font-semibold hover:bg-bg/25"
                    >
                      Ver su board
                    </Link>
                  )}
                  <button
                    className="text-bg/60 hover:text-bg"
                    onClick={() => setSelectedSeat(null)}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-muted">
            <span>
              Muévete con WASD o las flechas, Shift para correr. Acércate a algo
              y presiona E. Arrastra para girar, rueda para acercar. Cada
              personaje es un agente: escribe cuando trabaja, levanta la mano
              cuando te espera y se va al lounge si no tiene sesión.
            </span>
            <div className="flex items-center gap-2">
              <button
                className="rounded-full border border-line px-3 py-1 font-semibold text-ink hover:bg-bg"
                onClick={() => setBoardForced(true)}
              >
                Tablero de tareas ({tasks.length})
              </button>
              <Link
                href="/archivos"
                className="rounded-full border border-line px-3 py-1 font-semibold text-ink hover:bg-bg"
                title="Sube archivos para que tus agentes los lean, sin dar rutas"
              >
                Subir archivos
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <>
          <div
            className="flex flex-wrap items-center justify-between gap-2"
            aria-label="Estado del equipo"
          >
            <StatusPills
              active={active}
              waiting={waiting}
              pending={pending}
              conn={conn}
            />
            <Link
              href="/archivos"
              className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink hover:bg-bg"
              title="Sube archivos para que tus agentes los lean, sin dar rutas"
            >
              Subir archivos
            </Link>
          </div>
          {notice && (
            <div role="status" className="card border-amber px-4 py-3 text-sm">
              {notice}
            </div>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside
              className="flex flex-col gap-3 lg:sticky lg:top-4"
              aria-label="Tu equipo"
            >
              <div className="flex max-h-[60vh] lg:max-h-[calc(100vh-14rem)]">
                <TeamHud
                  seats={seats}
                  selectedKey={selectedSeat}
                  onOpen={talkTo}
                  linked={hasSession}
                  codexKeys={codexKeys}
                  coworkKeys={coworkKeys}
                />
              </div>
              {seat && (
                <div
                  className="card flex flex-col gap-2 p-3 text-xs"
                  aria-label={`Acciones de ${seat.member.name}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">
                      {seat.member.name}
                    </span>
                    <span className="text-muted">
                      {STATUS_LABEL[seat.status]}
                    </span>
                  </div>
                  <a
                    href={openLink(seat)}
                    className="rounded-full bg-blue px-3 py-1.5 text-center font-semibold text-white hover:opacity-90"
                  >
                    {hasSession(seat)
                      ? isCodex(seat)
                        ? "Abrir su conversación en Codex"
                        : isCowork(seat)
                          ? "Ir a su tarea en Cowork"
                          : "Abrir su conversación"
                      : seat.key === "coo"
                        ? "Nueva sesión de Code"
                        : "Nueva conversación en Cowork"}
                  </a>
                  {resume && (
                    <button
                      className="rounded-full border border-line px-3 py-1.5 font-semibold hover:bg-bg"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(resume)
                          .then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          })
                          .catch(() => {})
                      }
                    >
                      {copied ? "Copiado" : "Copiar comando para retomar"}
                    </button>
                  )}
                  {findAgent(seat.member.id) && (
                    <Link
                      href={`/canvas?agent=${encodeURIComponent(seat.member.id)}`}
                      className="rounded-full border border-line px-3 py-1.5 text-center font-semibold hover:bg-bg"
                    >
                      Ver su board
                    </Link>
                  )}
                  <button
                    className="text-muted hover:text-ink"
                    onClick={() => setSelectedSeat(null)}
                  >
                    Cerrar
                  </button>
                </div>
              )}
            </aside>
            {/* El Inicio es el canvas del proyecto (lo arma Assistant); el tablero de tareas vive en la pestaña Tareas. */}
            <ProjectHome />
          </div>
        </>
      )}
    </main>
  );
}
