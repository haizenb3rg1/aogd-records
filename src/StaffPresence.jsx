import { useEffect, useMemo, useState } from "react";
import { loadPublicStaff, sendStaffHeartbeat } from "./api.js";

const PRESENCE_LABELS = {
  online: "В сети",
  offline: "Не в сети",
  hidden: "Статус скрыт",
};

function formatPublicId(value) {
  return `ID ${String(Number(value) || 0).padStart(6, "0")}`;
}

export function RoleBadges({ roles = [], compact = false }) {
  if (!roles.length) return null;
  return <div className={`staff-role-badges${compact ? " staff-role-badges--compact" : ""}`}>
    {roles.map((role) => <span key={role.slug} style={{ "--role-color": role.color }}>{role.name}</span>)}
  </div>;
}

export default function StaffPresence({ user }) {
  const [staff, setStaff] = useState([]);
  const [open, setOpen] = useState(false);
  const onlineCount = useMemo(() => staff.filter((person) => person.presence === "online").length, [staff]);
  const isStaff = Boolean(user?.roles?.length);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await loadPublicStaff();
        if (active) setStaff(result);
      } catch {
        if (active) setStaff([]);
      }
    }
    refresh();
    const timer = window.setInterval(refresh, 45_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!isStaff || user?.presenceVisible === false) return undefined;
    let active = true;
    async function heartbeat() {
      if (!active || document.visibilityState !== "visible") return;
      try { await sendStaffHeartbeat(); } catch {}
    }
    heartbeat();
    const timer = window.setInterval(heartbeat, 60_000);
    const onVisibility = () => heartbeat();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isStaff, user?.presenceVisible]);

  if (!staff.length) return null;
  return (
    <aside className={`staff-presence${open ? " staff-presence--open" : ""}`} aria-label="Статус команды A.O.G.D">
      <button className="staff-presence-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="staff-presence-orb" aria-hidden="true" />
        <span><strong>Команда</strong><small>{onlineCount ? `${onlineCount} в сети` : "статусы сотрудников"}</small></span>
        <span className="staff-presence-chevron" aria-hidden="true">⌃</span>
      </button>
      <div className="staff-presence-panel">
        <div className="staff-presence-heading">
          <div><span>A.O.G.D staff</span><strong>Сотрудники организации</strong></div>
          <small>Статус обновляется автоматически</small>
        </div>
        <div className="staff-presence-list">
          {staff.map((person) => <article key={person.publicId} className={`staff-person staff-person--${person.presence}`}>
            <div className="staff-person-avatar">
              {person.nickname.slice(0, 2).toUpperCase()}
              <span className="staff-person-dot" aria-hidden="true" />
            </div>
            <div className="staff-person-copy">
              <div><strong>{person.nickname}</strong><small>{formatPublicId(person.publicId)}</small></div>
              <RoleBadges roles={person.roles} compact />
            </div>
            <span className="staff-person-state">{PRESENCE_LABELS[person.presence] || "Не в сети"}</span>
          </article>)}
        </div>
        <p className="staff-presence-privacy">Показывается только добровольный статус сотрудников. Сетевые адреса и точное время активности не публикуются.</p>
      </div>
    </aside>
  );
}
