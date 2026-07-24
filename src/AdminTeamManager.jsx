import { useEffect, useState } from "react";
import {
  createStaffRole,
  deleteStaffRole,
  loadAdminPeople,
  updateStaffRole,
  updatePersonRoles,
} from "./api.js";
import { RoleBadges } from "./StaffPresence.jsx";

function formattedId(value) {
  return `ID ${String(Number(value) || 0).padStart(6, "0")}`;
}

const PERMISSION_GROUPS = [
  {
    title: "Публичные записи",
    description: "Создание и изменение карточек публичного реестра.",
    items: [
      ["records.create", "Создавать записи"],
      ["records.update", "Редактировать записи"],
      ["records.delete", "Удалять записи"],
    ],
  },
  {
    title: "Техническая поддержка",
    description: "Доступ к обращениям, контактам заявителей и ответам.",
    items: [
      ["support.read", "Просматривать обращения"],
      ["support.update", "Отвечать и менять статус"],
    ],
  },
  {
    title: "Приёмная",
    description: "Модерация вопросов и защита личности анонимных авторов.",
    items: [
      ["reception.read", "Просматривать очередь"],
      ["reception.moderate", "Публиковать и отвечать"],
      ["reception.reveal_author", "Раскрывать автора по причине"],
    ],
  },
  {
    title: "Команда и должности",
    description: "Управление сотрудниками. Выдавайте эти права только доверенным лицам.",
    items: [
      ["staff.read", "Просматривать аккаунты и должности"],
      ["staff.assign_roles", "Назначать должности"],
      ["staff.manage_roles", "Создавать и удалять должности"],
      ["staff.manage_permissions", "Изменять права должностей"],
    ],
  },
  {
    title: "Безопасность",
    description: "Журнал действий, состояние защиты и административные сеансы.",
    items: [
      ["security.read", "Просматривать центр безопасности"],
      ["security.sessions.revoke", "Завершать другие админ-сеансы"],
    ],
  },
];

function can(access, permission) {
  return Boolean(access?.permissions?.includes("*") || access?.permissions?.includes(permission));
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
  const [access, setAccess] = useState(null);
  const [editingRole, setEditingRole] = useState(null);

  async function reload(search = query) {
    setLoading(true); setError("");
    try {
      const result = await loadAdminPeople(search);
      setPeople(result.people || []);
      setRoles(result.roles || []);
      setAccess(result.access || null);
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
      await createStaffRole({ name: roleName, color: roleColor, priority: 80, permissions: [] });
      setRoleName("");
      await reload();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusyId("");
    }
  }

  function beginRoleEdit(role) {
    setEditingRole({
      slug: role.slug,
      name: role.name,
      color: role.color,
      priority: role.priority,
      permissions: role.slug === "owner" ? ["*"] : [...(role.permissions || [])],
      system: role.system,
    });
  }

  function togglePermission(permission) {
    setEditingRole((current) => {
      if (!current || current.slug === "owner") return current;
      const selected = current.permissions.includes(permission);
      return {
        ...current,
        permissions: selected
          ? current.permissions.filter((item) => item !== permission)
          : [...current.permissions, permission],
      };
    });
  }

  async function saveRoleSettings(event) {
    event.preventDefault();
    if (!editingRole || editingRole.slug === "owner") return;
    setBusyId(`edit:${editingRole.slug}`); setError("");
    try {
      await updateStaffRole(editingRole.slug, {
        name: editingRole.name,
        color: editingRole.color,
        priority: editingRole.priority,
        permissions: editingRole.permissions,
      });
      setEditingRole(null);
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
          <div className="team-role-definition__actions">
            {(role.slug === "owner" || can(access, "staff.manage_permissions")) && <button type="button" onClick={() => beginRoleEdit(role)}>{role.slug === "owner" ? "Права" : "Настроить"}</button>}
            {!role.system && can(access, "staff.manage_roles") && <button type="button" disabled={busyId === `role:${role.slug}`} onClick={() => removeRole(role)}>Удалить</button>}
          </div>
        </div>)}
      </div>
      {can(access, "staff.manage_roles") && <form className="team-role-create" onSubmit={addRole}>
        <label>Название новой должности<input value={roleName} onChange={(event) => setRoleName(event.target.value)} minLength="2" maxLength="28" placeholder="Например: Аналитик" required /></label>
        <label>Цвет<input type="color" value={roleColor} onChange={(event) => setRoleColor(event.target.value)} /></label>
        <button className="button button--secondary" disabled={busyId === "new-role"}>{busyId === "new-role" ? "Создание…" : "Создать должность"}</button>
      </form>}
      {editingRole && <form className="role-permission-editor" onSubmit={saveRoleSettings}>
        <div className="role-permission-editor__heading">
          <div><strong>{editingRole.slug === "owner" ? "Owner — полный доступ" : `Настройка: ${editingRole.name}`}</strong><span>{editingRole.slug === "owner" ? "Эта должность всегда имеет все права и защищена от ограничения." : "Отметьте только необходимые действия. Проверка выполняется сервером для каждого запроса."}</span></div>
          <button type="button" className="icon-button" onClick={() => setEditingRole(null)} aria-label="Закрыть">×</button>
        </div>
        {editingRole.slug !== "owner" && <div className="role-permission-meta">
          <label>Название<input value={editingRole.name} onChange={(event) => setEditingRole((current) => ({ ...current, name: event.target.value }))} minLength="2" maxLength="28" required /></label>
          <label>Цвет<input type="color" value={editingRole.color} onChange={(event) => setEditingRole((current) => ({ ...current, color: event.target.value }))} /></label>
          <label>Приоритет<input type="number" min="15" max="150" value={editingRole.priority} onChange={(event) => setEditingRole((current) => ({ ...current, priority: Number(event.target.value) }))} /></label>
        </div>}
        <div className="permission-groups">
          {PERMISSION_GROUPS.map((group) => <fieldset key={group.title} disabled={editingRole.slug === "owner"}>
            <legend>{group.title}</legend>
            <p>{group.description}</p>
            {group.items.map(([permission, label]) => <label key={permission}>
              <input type="checkbox" checked={editingRole.slug === "owner" || editingRole.permissions.includes(permission)} onChange={() => togglePermission(permission)} />
              <span><strong>{label}</strong><small>{permission}</small></span>
            </label>)}
          </fieldset>)}
        </div>
        <div className="role-permission-editor__footer">
          <span>{editingRole.slug === "owner" ? "Все разрешения активны" : `Выбрано: ${editingRole.permissions.length}`}</span>
          <div><button type="button" className="button button--secondary" onClick={() => setEditingRole(null)}>Отмена</button>{editingRole.slug !== "owner" && <button className="button button--primary" disabled={busyId === `edit:${editingRole.slug}`}>{busyId === `edit:${editingRole.slug}` ? "Сохранение…" : "Сохранить права"}</button>}</div>
        </div>
      </form>}
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
          {can(access, "staff.assign_roles") && <div className="team-role-picker">
            {roles.map((role) => <label key={role.slug} style={{ "--role-color": role.color }}>
              <input type="checkbox" disabled={role.slug === "owner" && !can(access, "staff.manage_permissions")} checked={person.roles.some((item) => item.slug === role.slug)} onChange={() => toggleLocalRole(person.id, role.slug)} />
              <span>{role.name}</span>
            </label>)}
          </div>}
          {can(access, "staff.assign_roles") && <button className="button button--primary team-save-roles" disabled={busyId === person.id} onClick={() => saveRoles(person)}>
            {busyId === person.id ? "Сохранение…" : "Сохранить назначения"}
          </button>}
        </article>)}
        {!people.length && <div className="empty-state">Аккаунты не найдены.</div>}
      </div>}
    </div>
  </section>;
}
