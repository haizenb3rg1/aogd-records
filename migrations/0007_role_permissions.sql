ALTER TABLE staff_roles ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE staff_roles ADD COLUMN is_editable INTEGER NOT NULL DEFAULT 1 CHECK (is_editable IN (0, 1));
ALTER TABLE staff_roles ADD COLUMN updated_at TEXT;

UPDATE staff_roles
SET
  description = CASE slug
    WHEN 'owner' THEN 'Полный неизменяемый доступ владельца.'
    WHEN 'director' THEN 'Операционное управление организацией.'
    WHEN 'security' THEN 'Безопасность, аудит и управление сеансами.'
    WHEN 'moderator' THEN 'Модерация обращений и публикаций.'
    WHEN 'support' THEN 'Работа с обращениями технической поддержки.'
    WHEN 'press' THEN 'Подготовка и публикация материалов.'
    ELSE 'Сотрудник организации.'
  END,
  is_editable = CASE WHEN slug = 'owner' THEN 0 ELSE 1 END,
  updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS permissions (
  key TEXT PRIMARY KEY,
  name_ru TEXT NOT NULL,
  name_en TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_dangerous INTEGER NOT NULL DEFAULT 0 CHECK (is_dangerous IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_slug TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  granted_by TEXT,
  PRIMARY KEY (role_slug, permission_key),
  FOREIGN KEY (role_slug) REFERENCES staff_roles(slug) ON DELETE CASCADE,
  FOREIGN KEY (permission_key) REFERENCES permissions(key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS permissions_category_idx
ON permissions(category, key);

CREATE INDEX IF NOT EXISTS role_permissions_permission_idx
ON role_permissions(permission_key, role_slug);

INSERT OR IGNORE INTO permissions
  (key, name_ru, name_en, category, description, is_dangerous, created_at)
VALUES
  ('users.view', 'Просмотр пользователей', 'View users', 'users', 'Просматривать список аккаунтов без адресов электронной почты.', 0, CURRENT_TIMESTAMP),
  ('users.disable', 'Блокировка пользователей', 'Disable users', 'users', 'Отключать пользовательские аккаунты и их активные сеансы.', 1, CURRENT_TIMESTAMP),
  ('users.enable', 'Разблокировка пользователей', 'Enable users', 'users', 'Возвращать доступ ранее отключённым аккаунтам.', 1, CURRENT_TIMESTAMP),
  ('users.assign_roles', 'Назначение ролей', 'Assign roles', 'users', 'Назначать пользователям только доступные сотруднику роли.', 1, CURRENT_TIMESTAMP),
  ('users.view_email', 'Просмотр почты', 'View email addresses', 'users', 'Просматривать адреса электронной почты пользователей.', 1, CURRENT_TIMESTAMP),

  ('records.view', 'Просмотр записей', 'View records', 'records', 'Просматривать административный список записей.', 0, CURRENT_TIMESTAMP),
  ('records.create', 'Создание записей', 'Create records', 'records', 'Создавать черновики записей.', 0, CURRENT_TIMESTAMP),
  ('records.edit', 'Редактирование записей', 'Edit records', 'records', 'Изменять содержимое существующих записей.', 0, CURRENT_TIMESTAMP),
  ('records.publish', 'Публикация записей', 'Publish records', 'records', 'Переводить записи в публичные статусы.', 1, CURRENT_TIMESTAMP),
  ('records.archive', 'Архивация записей', 'Archive records', 'records', 'Перемещать записи в архив и возвращать их из архива.', 1, CURRENT_TIMESTAMP),
  ('records.delete', 'Удаление записей', 'Delete records', 'records', 'Безвозвратно удалять записи и связанные фотографии.', 1, CURRENT_TIMESTAMP),

  ('support.view', 'Просмотр обращений', 'View support requests', 'support', 'Просматривать очередь обращений без приватных контактов.', 0, CURRENT_TIMESTAMP),
  ('support.reply', 'Ответы поддержки', 'Reply to support requests', 'support', 'Добавлять официальный ответ или заметку поддержки.', 0, CURRENT_TIMESTAMP),
  ('support.change_status', 'Статусы обращений', 'Change support status', 'support', 'Менять состояние обращения.', 0, CURRENT_TIMESTAMP),
  ('support.view_private', 'Приватные данные обращений', 'View private support data', 'support', 'Просматривать email, Telegram и закрытые заметки заявителей.', 1, CURRENT_TIMESTAMP),
  ('support.delete', 'Удаление обращений', 'Delete support requests', 'support', 'Безвозвратно удалять обращения.', 1, CURRENT_TIMESTAMP),

  ('reception.view', 'Просмотр приёмной', 'View reception', 'reception', 'Просматривать очередь вопросов и предложений.', 0, CURRENT_TIMESTAMP),
  ('reception.answer', 'Ответы приёмной', 'Answer reception threads', 'reception', 'Добавлять официальный ответ.', 0, CURRENT_TIMESTAMP),
  ('reception.moderate', 'Модерация приёмной', 'Moderate reception', 'reception', 'Отклонять, архивировать и запрашивать уточнения.', 0, CURRENT_TIMESTAMP),
  ('reception.publish', 'Публикация в приёмной', 'Publish reception threads', 'reception', 'Публиковать вопросы и официальные ответы.', 1, CURRENT_TIMESTAMP),
  ('reception.view_author', 'Раскрытие автора', 'View reception author', 'reception', 'Раскрывать автора анонимного обращения с обязательной причиной.', 1, CURRENT_TIMESTAMP),

  ('roles.view', 'Просмотр ролей', 'View roles', 'roles', 'Просматривать роли и их разрешения.', 0, CURRENT_TIMESTAMP),
  ('roles.create', 'Создание ролей', 'Create roles', 'roles', 'Создавать новые пользовательские роли.', 1, CURRENT_TIMESTAMP),
  ('roles.edit', 'Редактирование ролей', 'Edit roles', 'roles', 'Изменять название, описание, цвет и приоритет роли.', 1, CURRENT_TIMESTAMP),
  ('roles.delete', 'Удаление ролей', 'Delete roles', 'roles', 'Удалять пользовательские роли у всех сотрудников.', 1, CURRENT_TIMESTAMP),
  ('roles.assign', 'Назначение ролей', 'Assign roles', 'roles', 'Назначать роли пользователям без повышения собственных привилегий.', 1, CURRENT_TIMESTAMP),
  ('roles.manage_permissions', 'Управление разрешениями', 'Manage role permissions', 'roles', 'Изменять набор серверных полномочий роли.', 1, CURRENT_TIMESTAMP),

  ('security.view_audit', 'Просмотр аудита', 'View audit log', 'security', 'Просматривать журнал административных действий.', 1, CURRENT_TIMESTAMP),
  ('security.view_sessions', 'Просмотр сеансов', 'View sessions', 'security', 'Просматривать агрегированную информацию об активных сеансах.', 1, CURRENT_TIMESTAMP),
  ('security.revoke_sessions', 'Отзыв сеансов', 'Revoke sessions', 'security', 'Принудительно завершать другие административные сеансы.', 1, CURRENT_TIMESTAMP),
  ('security.manage_settings', 'Настройки безопасности', 'Manage security settings', 'security', 'Изменять критичные параметры защиты.', 1, CURRENT_TIMESTAMP),

  ('site.manage_maintenance', 'Режим техработ', 'Manage maintenance mode', 'site', 'Включать и выключать режим технических работ.', 1, CURRENT_TIMESTAMP),
  ('site.manage_content', 'Содержимое сайта', 'Manage site content', 'site', 'Редактировать управляемое содержимое сайта.', 1, CURRENT_TIMESTAMP);

-- Owner intentionally has no rows: the server grants it the immutable "*" permission.
INSERT OR IGNORE INTO role_permissions (role_slug, permission_key, granted_at, granted_by)
SELECT 'director', key, CURRENT_TIMESTAMP, 'migration:0007'
FROM permissions
WHERE key IN (
  'users.view', 'users.assign_roles', 'records.view', 'records.create', 'records.edit',
  'records.publish', 'records.archive', 'records.delete', 'support.view', 'support.reply',
  'support.change_status', 'support.view_private', 'reception.view', 'reception.answer',
  'reception.moderate', 'reception.publish', 'roles.view', 'roles.assign'
);

INSERT OR IGNORE INTO role_permissions (role_slug, permission_key, granted_at, granted_by)
SELECT 'security', key, CURRENT_TIMESTAMP, 'migration:0007'
FROM permissions
WHERE key IN (
  'users.view', 'users.view_email', 'reception.view', 'reception.view_author',
  'roles.view', 'security.view_audit', 'security.view_sessions', 'security.revoke_sessions'
);

INSERT OR IGNORE INTO role_permissions (role_slug, permission_key, granted_at, granted_by)
SELECT 'moderator', key, CURRENT_TIMESTAMP, 'migration:0007'
FROM permissions
WHERE key IN (
  'support.view', 'support.reply', 'support.change_status', 'reception.view',
  'reception.answer', 'reception.moderate', 'reception.publish'
);

INSERT OR IGNORE INTO role_permissions (role_slug, permission_key, granted_at, granted_by)
SELECT 'support', key, CURRENT_TIMESTAMP, 'migration:0007'
FROM permissions
WHERE key IN ('support.view', 'support.reply', 'support.change_status', 'support.view_private');

INSERT OR IGNORE INTO role_permissions (role_slug, permission_key, granted_at, granted_by)
SELECT 'press', key, CURRENT_TIMESTAMP, 'migration:0007'
FROM permissions
WHERE key IN ('records.view', 'records.create', 'records.edit', 'records.publish', 'reception.view');
