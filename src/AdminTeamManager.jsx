import { useEffect, useState } from "react";
import {
  createStaffRole,
  deleteStaffRole,
  loadAdminPeople,
  updateStaffRole,
  updatePersonRoles,
  updatePersonStatus,
} from "./api.js";
import { RoleBadges } from "./StaffPresence.jsx";

function formattedId(value) {
  return `ID ${String(Number(value) || 0).padStart(6, "0")}`;
}

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
  const [permissionCatalog, setPermissionCatalog] = useState([]);
  const [permissionSearch, setPermissionSearch] = useState("");
  const language = localStorage.getItem("aogd-language") === "en" ? "en" : "ru";
  const categoryNames = {
    users: language === "en" ? "Users" : "Пользователи",
    records: language === "en" ? "Records" : "Публичные записи",
    support: language === "en" ? "Support" : "Техническая поддержка",
    reception: language === "en" ? "Reception" : "Приёмная",
    roles: language === "en" ? "Roles" : "Роли и должности",
    security: language === "en" ? "Security" : "Безопасность",
    site: language === "en" ? "Site" : "Сайт",
  };
  const visiblePermissions = permissionCatalog.filter((permission) => {
    const haystack = `${permission.key} ${permission.nameRu} ${permission.nameEn} ${permission.description}`.toLowerCase();
    return haystack.includes(permissionSearch.trim().toLowerCase());
  });
  const permissionGroups = Object.entries(
    visiblePermissions.reduce((groups, permission) => {
      (groups[permission.category] ||= []).push(permission);
      return groups;
    }, {}),
  );

  async function reload(search = query) {
    setLoading(true); setError("");
    try {
      const result = await loadAdminPeople(search);
      setPeople(result.people || []);
      setRoles(result.roles || []);
      setAccess(result.access || null);
      setPermissionCatalog(result.permissionCatalog || []);
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

  async function changePersonStatus(person) {
    const nextDisabled = !person.disabled;
    if (!window.confirm(
      nextDisabled
        ? `Отключить аккаунт «${person.nickname}» и завершить его сеансы?`
        : `Вернуть доступ аккаунту «${person.nickname}»?`,
    )) return;
    setBusyId(`status:${person.id}`); setError("");
    try {
      await updatePersonStatus(person.id, nextDisabled);
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
      await createStaffRole({ name: roleName, description: "", color: roleColor, priority: 80, permissions: [] });
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
      description: role.description || "",
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
      const dangerous = permissionCatalog.filter(
        (permission) => permission.dangerous && editingRole.permissions.includes(permission.key),
      );
      if (dangerous.length && !window.confirm(
        `У роли будет ${dangerous.length} опасных разрешений. Подтвердите выдачу повышенных полномочий.`,
      )) return;
      await updateStaffRole(editingRole.slug, {
        name: editingRole.name,
        description: editingRole.description,
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
            {(role.slug === "owner" || can(access, "roles.edit") || can(access, "roles.manage_permissions")) && <button type="button" onClick={() => beginRoleEdit(role)}>{role.slug === "owner" ? "Права" : "Настроить"}</button>}
            {!role.system && can(access, "roles.delete") && <button type="button" disabled={busyId === `role:${role.slug}`} onClick={() => removeRole(role)}>Удалить</button>}
          </div>
        </div>)}
      </div>
      {can(access, "roles.create") && <form className="team-role-create" onSubmit={addRole}>
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
          <label>Описание<input value={editingRole.description} onChange={(event) => setEditingRole((current) => ({ ...current, description: event.target.value }))} maxLength="240" /></label>
          <label>Цвет<input type="color" value={editingRole.color} onChange={(event) => setEditingRole((current) => ({ ...current, color: event.target.value }))} /></label>
          <label>Приоритет<input type="number" min="15" max="150" value={editingRole.priority} onChange={(event) => setEditingRole((current) => ({ ...current, priority: Number(event.target.value) }))} /></label>
        </div>}
        <label className="permission-search">Поиск разрешения<input value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} placeholder="Название или ключ…" /></label>
        <div className="permission-groups">
          {permissionGroups.map(([category, permissions]) => <fieldset key={category} disabled={editingRole.slug === "owner" || !can(access, "roles.manage_permissions")}>
            <legend>{categoryNames[category] || category}</legend>
            <div className="permission-group-actions">
              <button type="button" onClick={() => setEditingRole((current) => ({ ...current, permissions: [...new Set([...current.permissions, ...permissions.map((item) => item.key)])] }))}>Выбрать раздел</button>
              <button type="button" onClick={() => setEditingRole((current) => ({ ...current, permissions: current.permissions.filter((key) => !permissions.some((item) => item.key === key)) }))}>Очистить</button>
            </div>
            {permissions.map((permission) => <label key={permission.key} className={permission.dangerous ? "permission-dangerous" : ""}>
              <input type="checkbox" checked={editingRole.slug === "owner" || editingRole.permissions.includes(permission.key)} onChange={() => togglePermission(permission.key)} />
              <span><strong>{language === "en" ? permission.nameEn : permission.nameRu}{permission.dangerous ? " ⚠" : ""}</strong><small>{permission.key}</small><small>{permission.description}</small></span>
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
            <div><strong>{person.nickname}</strong>{person.email && <span>{person.email}</span>}<small>{formattedId(person.publicId)} · {person.verified ? "почта подтверждена" : "почта не подтверждена"}{person.disabled ? " · аккаунт отключён" : ""}</small></div>
          </div>
          <div className="team-person-current"><RoleBadges roles={person.roles} compact />{!person.roles.length && <span>Обычный участник</span>}</div>
          {can(access, "roles.assign") && can(access, "users.assign_roles") && <div className="team-role-picker">
            {roles.map((role) => <label key={role.slug} style={{ "--role-color": role.color }}>
              <input type="checkbox" disabled={person.id === access?.userId || (role.slug === "owner" && !access?.permissions?.includes("*"))} checked={person.roles.some((item) => item.slug === role.slug)} onChange={() => toggleLocalRole(person.id, role.slug)} />
              <span>{role.name}</span>
            </label>)}
          </div>}
          {can(access, "roles.assign") && can(access, "users.assign_roles") && <button className="button button--primary team-save-roles" disabled={busyId === person.id || person.id === access?.userId} onClick={() => saveRoles(person)}>
            {busyId === person.id ? "Сохранение…" : "Сохранить назначения"}
          </button>}
          {can(access, person.disabled ? "users.enable" : "users.disable") && person.id !== access?.userId && <button className={`button ${person.disabled ? "button--secondary" : "danger"}`} disabled={busyId === `status:${person.id}`} onClick={() => changePersonStatus(person)}>
            {busyId === `status:${person.id}` ? "Сохранение…" : person.disabled ? "Разблокировать аккаунт" : "Отключить аккаунт"}
          </button>}
        </article>)}
        {!people.length && <div className="empty-state">Аккаунты не найдены.</div>}
      </div>}
    </div>
  </section>;
}
