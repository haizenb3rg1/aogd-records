import { useEffect, useState } from "react";
import {
  createStaffRole,
  deleteStaffRole,
  loadAdminPeople,
  updatePersonRoles,
} from "./api.js";
import { RoleBadges } from "./StaffPresence.jsx";

function formattedId(value) {
  return `ID ${String(Number(value) || 0).padStart(6, "0")}`;
}

export default function AdminTeamManager() {
  const [people, setPeople] = useState([]);
  const [roles, setRoles] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleColor, setRoleColor] = useState("#67a2ff");

  async function reload(search = query) {
    setLoading(true); setError("");
    try {
      const result = await loadAdminPeople(search);
      setPeople(result.people || []);
      setRoles(result.roles || []);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => reload(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  function toggleLocalRole(userId, slug) {
    setPeople((current) => current.map((person) => {
      if (person.id !== userId) return person;
      const selected = person.roles.some((role) => role.slug === slug);
      const nextRoles = selected
        ? person.roles.filter((role) => role.slug !== slug)
        : [...person.roles, roles.find((role) => role.slug === slug)].filter(Boolean);
      return { ...person, roles: nextRoles };
    }));
  }

  async function saveRoles(person) {
    setBusyId(person.id); setError("");
    try {
      await updatePersonRoles(person.id, person.roles.map((role) => role.slug));
      await reload();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusyId("");
    }
  }

  async function addRole(event) {
    event.preventDefault();
    setBusyId("new-role"); setError("");
    try {
      await createStaffRole({ name: roleName, color: roleColor, priority: 80 });
      setRoleName("");
      await reload();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusyId("");
    }
  }

  async function removeRole(role) {
    if (!window.confirm(`Удалить должность «${role.name}» у всех пользователей?`)) return;
    setBusyId(`role:${role.slug}`); setError("");
    try {
      await deleteStaffRole(role.slug);
      await reload();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusyId("");
    }
  }

  return <section className="admin-team">
    <div className="admin-card team-role-card">
      <div className="admin-toolbar">
        <div><strong>Должности и касты</strong><span>Системные должности защищены от удаления. Пользователь не может назначить их себе самостоятельно.</span></div>
      </div>
      <div className="team-role-list">
        {roles.map((role) => <div key={role.slug} className="team-role-definition">
          <span className="team-role-color" style={{ "--role-color": role.color }} />
          <div><strong>{role.name}</strong><small>{role.system ? "Системная должность" : "Пользовательская должность"}</small></div>
          {!role.system && <button type="button" disabled={busyId === `role:${role.slug}`} onClick={() => removeRole(role)}>Удалить</button>}
        </div>)}
      </div>
      <form className="team-role-create" onSubmit={addRole}>
        <label>Название новой должности<input value={roleName} onChange={(event) => setRoleName(event.target.value)} minLength="2" maxLength="28" placeholder="Например: Аналитик" required /></label>
        <label>Цвет<input type="color" value={roleColor} onChange={(event) => setRoleColor(event.target.value)} /></label>
        <button className="button button--secondary" disabled={busyId === "new-role"}>{busyId === "new-role" ? "Создание…" : "Создать должность"}</button>
      </form>
    </div>

    <div className="admin-card team-people-card">
      <div className="admin-toolbar">
        <div><strong>Состав организации</strong><span>Найдите аккаунт по никнейму, почте или цифровому ID и назначьте должности.</span></div>
        <input className="team-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск аккаунта…" />
      </div>
      {error && <div className="form-error admin-error">{error}</div>}
      {loading ? <div className="empty-state">Загрузка аккаунтов…</div> : <div className="team-people-list">
        {people.map((person) => <article key={person.id} className="team-person-editor">
          <div className="team-person-identity">
            <div className="team-person-avatar">{person.nickname.slice(0, 2).toUpperCase()}<span className={`team-presence-dot team-presence-dot--${person.presence}`} /></div>
            <div><strong>{person.nickname}</strong><span>{person.email}</span><small>{formattedId(person.publicId)} · {person.verified ? "почта подтверждена" : "почта не подтверждена"}</small></div>
          </div>
          <div className="team-person-current"><RoleBadges roles={person.roles} compact />{!person.roles.length && <span>Обычный участник</span>}</div>
          <div className="team-role-picker">
            {roles.map((role) => <label key={role.slug} style={{ "--role-color": role.color }}>
              <input type="checkbox" checked={person.roles.some((item) => item.slug === role.slug)} onChange={() => toggleLocalRole(person.id, role.slug)} />
              <span>{role.name}</span>
            </label>)}
          </div>
          <button className="button button--primary team-save-roles" disabled={busyId === person.id} onClick={() => saveRoles(person)}>
            {busyId === person.id ? "Сохранение…" : "Сохранить назначения"}
          </button>
        </article>)}
        {!people.length && <div className="empty-state">Аккаунты не найдены.</div>}
      </div>}
    </div>
  </section>;
}
