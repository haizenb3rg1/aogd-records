import { useEffect } from "react";

const RU_TO_EN = {
  "На главную": "Home",
  "Основная навигация": "Main navigation",
  "Открытые досье": "Open dossiers",
  "Управление": "Admin",
  "Тема оформления": "Color theme",
  "Светлая тема": "Light theme",
  "Стандартная синяя тема": "Standard blue theme",
  "Тёмная тема": "Dark theme",
  "Настройки": "Settings",
  "Настройки интерфейса": "Interface settings",
  "Персонализация": "Personalization",
  "Оформление": "Appearance",
  "Интерфейс": "Interface",
  "Цветовая тема": "Color theme",
  "Выберите оформление, которое приятнее для глаз.": "Choose the appearance that feels best for your eyes.",
  "Светлая": "Light",
  "Синяя": "Blue",
  "Тёмная": "Dark",
  "Выбрано": "Selected",
  "Размер текста": "Text size",
  "Настройте удобный масштаб интерфейса.": "Choose a comfortable interface scale.",
  "Меньше": "Smaller",
  "Обычно": "Default",
  "Крупнее": "Larger",
  "Компактные карточки": "Compact cards",
  "Показывать больше досье на экране.": "Show more dossiers on the screen.",
  "Меньше анимаций": "Reduce motion",
  "Уменьшить движение и плавные эффекты.": "Reduce movement and transition effects.",
  "Настройки сохраняются только на этом устройстве.": "Settings are saved only on this device.",
  "Разыскивается": "Wanted",
  "Особое внимание": "Priority notice",
  "Местонахождение установлено": "Located",
  "Архив": "Archived",
  "Критический": "Critical",
  "Высокий": "High",
  "Средний": "Medium",
  "Низкий": "Low",
  "Без имени": "Unnamed",
  "Псевдонимы не указаны": "No aliases listed",
  "Юзернейм": "Username",
  "Не указан": "Not specified",
  "Место обитания": "Place of residence",
  "Не указано": "Not specified",
  "Дата рождения": "Date of birth",
  "Не указана": "Not specified",
  "Открыть досье": "Open record",
  "Закрыть": "Close",
  "Публичная информационная запись": "Public information record",
  "Демонстрационные данные.": "Demo data.",
  "Эта запись вымышленная и нужна только для знакомства с интерфейсом.": "This record is fictional and is provided only to demonstrate the interface.",
  "Идентификационные данные": "Identification details",
  "Гражданство": "Nationality",
  "Пол": "Gender",
  "Рост": "Height",
  "Глаза": "Eyes",
  "Волосы": "Hair",
  "Языки": "Languages",
  "Уровень внимания": "Priority level",
  "Основание публикации": "Publication basis",
  "Не указано.": "Not specified.",
  "Описание": "Description",
  "Описание отсутствует.": "No description provided.",
  "Особые приметы": "Identifying marks",
  "Не указаны.": "Not specified.",
  "Последнее известное местонахождение": "Last known location",
  "Нет данных.": "No data.",
  "Не предпринимайте самостоятельных действий. Передайте информацию организации.": "Do not take independent action. Forward any information to the organization.",
  "Открытый информационный реестр": "Open information registry",
  "Публичная база": "Public wanted",
  "ориентировок A.O.G.D": "persons database A.O.G.D",
  "Поиск по опубликованным записям организации Agency Of Good Deeds. Используйте фильтры или номер досье.": "Search the records published by the Agency Of Good Deeds. Use the filters or a record number.",
  "Имя, псевдоним, номер или место…": "Name, alias, number or location…",
  "Поиск по базе": "Search records",
  "Очистить поиск": "Clear search",
  "Актуальные публикации": "Current publications",
  "Записи базы": "Database records",
  "найдено": "found",
  "Фильтры статуса": "Status filters",
  "Все записи": "All records",
  "Демо-режим: данные хранятся только в этом браузере. После подключения Cloudflare они будут общими и постоянными.": "Demo mode: data is stored only in this browser. After Cloudflare is connected, it will become shared and persistent.",
  "Загрузка записей…": "Loading records…",
  "Ничего не найдено": "Nothing found",
  "Измените запрос или выберите другой статус.": "Change your search or select another status.",
  "Важная информация": "Important information",
  "A.O.G.D — самостоятельный проект и не является подразделением INTERPOL или государственного органа.": "A.O.G.D is an independent project and is not a division of INTERPOL or any government authority.",
  "Закрытый раздел": "Restricted area",
  "Панель управления": "Administration panel",
  "Введите секретный пароль администратора. Он не сохраняется в базе и действует только в этой вкладке.": "Enter the administrator password. It is not stored in the database and remains active only in this tab.",
  "Пароль администратора": "Administrator password",
  "Не менее 8 символов": "At least 8 characters",
  "Проверка…": "Checking…",
  "Войти": "Sign in",
  "Демо-режим: при первом входе придумайте пароль. На опубликованном сайте пароль задаётся секретом Cloudflare.": "Demo mode: create a password on first sign-in. On the published site, the password is set as a Cloudflare secret.",
  "Сбросить локальный пароль": "Reset local password",
  "Редактор записи": "Record editor",
  "Изменить досье": "Edit record",
  "Новое досье": "New record",
  "Загрузить фото": "Upload photo",
  "JPG, PNG или WebP до 10 МБ": "JPG, PNG or WebP up to 10 MB",
  "Удалить фотографию": "Remove photo",
  "Фото автоматически уменьшается и переводится в WebP перед загрузкой.": "The photo is automatically resized and converted to WebP before upload.",
  "Основное": "General",
  "Полное имя *": "Full name *",
  "Номер досье": "Record number",
  "Создастся автоматически": "Generated automatically",
  "Псевдонимы": "Aliases",
  "Статус": "Status",
  "Идентификация": "Identification",
  "Город, район или регион": "City, district or region",
  "Юзернейм Telegram": "Telegram username",
  "Например: 181 см": "Example: 181 cm",
  "Цвет глаз": "Eye color",
  "Цвет волос": "Hair color",
  "Сведения": "Details",
  "Последнее известное место": "Last known location",
  "Основание публикации *": "Publication basis *",
  "Предупреждение посетителям": "Visitor warning",
  "Отмена": "Cancel",
  "Сохранение…": "Saving…",
  "Сохранить запись": "Save record",
  "Управление базой": "Database management",
  "Добавляйте, обновляйте и архивируйте публичные записи.": "Create, update and archive public records.",
  "Выйти": "Sign out",
  "Добавить запись": "Add record",
  "Постоянное хранилище подключено": "Persistent storage connected",
  "Локальный демо-режим": "Local demo mode",
  "Данные и фотографии сохраняются в Cloudflare.": "Data and photos are stored in Cloudflare.",
  "Изменения видны только в этом браузере. Подключите Cloudflare перед рабочей публикацией.": "Changes are visible only in this browser. Connect Cloudflare before production publishing.",
  "Найти запись…": "Find a record…",
  "Запись": "Record",
  "Номер": "Number",
  "Обновлено": "Updated",
  "Действия": "Actions",
  "Без псевдонимов": "No aliases",
  "Изменить": "Edit",
  "Удалить": "Delete",
  "Записей пока нет": "No records yet",
  "Создайте первую публикацию.": "Create the first publication.",
  "Восстановить демонстрационные данные": "Restore demo data",
  "Предпросмотр": "Preview",
  "Эмблема A.O.G.D": "A.O.G.D emblem",
  "Локальный пароль должен содержать не менее 8 символов.": "The local password must contain at least 8 characters.",
  "Неверный пароль администратора.": "Incorrect administrator password.",
  "Не удалось прочитать фотографию.": "Could not read the photo.",
  "Выберите изображение JPG, PNG или WebP.": "Select a JPG, PNG or WebP image.",
  "Исходный файл должен быть меньше 10 МБ.": "The source file must be smaller than 10 MB.",
  "Не удалось обработать фотографию.": "Could not process the photo.",
  "После обработки фотография превышает 5 МБ.": "The processed photo exceeds 5 MB."
  ,"База D1 не подключена.": "The D1 database is not connected."
  ,"Хранилище фотографий R2 не подключено.": "The R2 photo storage is not connected."
  ,"Запись не найдена.": "Record not found."
  ,"Не удалось загрузить базу.": "Could not load the database."
  ,"Не удалось создать запись.": "Could not create the record."
  ,"Не удалось обновить запись.": "Could not update the record."
  ,"Не удалось удалить запись.": "Could not delete the record."
  ,"Укажите полное имя.": "Enter the full name."
  ,"Укажите основание публикации.": "Enter the publication basis."
  ,"Некорректные данные формы.": "Invalid form data."
  ,"Реестр": "Registry"
  ,"Принципы": "Principles"
  ,"Передать сведения": "Submit information"
  ,"Действия с досье": "Record actions"
  ,"Скопировать номер": "Copy record number"
  ,"Номер скопирован": "Record number copied"
  ,"Версия для печати": "Print version"
  ,"Дата обновления:": "Updated:"
  ,"не указана": "not specified"
  ,"Сводка реестра": "Registry overview"
  ,"Информация,": "Information"
  ,"которая имеет значение": "that makes a difference"
  ,"Официальный публичный реестр A.O.G.D для поиска по опубликованным ориентировкам и проверенным информационным записям.": "The official A.O.G.D public registry for searching published notices and verified information records."
  ,"Перейти к реестру": "Open the registry"
  ,"Публичных записей": "Public records"
  ,"доступно для поиска": "available for search"
  ,"В активном статусе": "Active status"
  ,"требуют внимания": "require attention"
  ,"Статусов реестра": "Registry statuses"
  ,"единая классификация": "unified classification"
  ,"Последнее обновление": "Last updated"
  ,"по данным публикаций": "based on publication data"
  ,"Сортировка": "Sort"
  ,"Сначала обновлённые": "Recently updated"
  ,"По уровню внимания": "By priority level"
  ,"По имени": "By name"
  ,"Стандарт публичной работы": "Public operating standard"
  ,"Ответственность начинается": "Responsibility begins"
  ,"с точности информации": "with accurate information"
  ,"Реестр создаётся как понятный и дисциплинированный инструмент: минимум лишних данных, ясный статус записи и возможность сообщить об ошибке.": "The registry is designed as a clear and disciplined tool: minimal unnecessary data, a clear record status and a way to report an error."
  ,"Проверяемость": "Verifiability"
  ,"Основание публикации указывается прямо в досье, чтобы происхождение записи было понятно посетителю.": "The publication basis is shown directly in the record so visitors can understand why it appears in the registry."
  ,"Цифровая безопасность": "Digital safety"
  ,"Наша задача — снизить риск для пользователей Telegram и помочь передать важную информацию безопасным способом.": "Our goal is to reduce risk for Telegram users and provide a safer way to submit important information."
  ,"Право на уточнение": "Right to clarification"
  ,"Ошибочные или устаревшие сведения можно направить на повторную проверку через официальный канал проекта.": "Incorrect or outdated information can be submitted for review through the project's official channel."
  ,"Защищённый канал связи": "Secure communication channel"
  ,"У вас есть значимые сведения?": "Do you have relevant information?"
  ,"Сообщите команде A.O.G.D номер досье и только те факты, которые можно проверить. Не вступайте в контакт с человеком из ориентировки и не публикуйте личные данные в открытых комментариях.": "Send the A.O.G.D team the record number and only facts that can be verified. Do not contact the person in the notice or publish personal data in open comments."
  ,"Укажите номер записи": "Include the record number"
  ,"Приложите подтверждение": "Attach supporting evidence"
  ,"Сохраните конфиденциальность": "Protect confidentiality"
  ,"Связаться в Telegram": "Contact us on Telegram"
  ,"Справочный центр": "Help center"
  ,"Как устроен реестр": "How the registry works"
  ,"Короткие ответы на вопросы, которые чаще всего возникают при просмотре публичных записей.": "Short answers to common questions about public records."
  ,"Что означает статус записи?": "What does a record status mean?"
  ,"Статус показывает текущее состояние публикации: активный поиск, особое внимание, установленное местонахождение или архив.": "The status shows the current state of a publication: active search, priority notice, located or archived."
  ,"Как сообщить об ошибке в досье?": "How can I report an error in a record?"
  ,"Передайте номер досье и описание неточности через официальный канал или центр поддержки. Не отправляйте личную или заведомо недостоверную информацию.": "Send the record number and a description of the error through the official channel or support center. Do not submit private or knowingly false information."
  ,"Как понять, что досье актуально?": "How can I tell whether a record is current?"
  ,"Проверьте текущий статус и дату обновления в открытом досье. Записи с завершённой проверкой переводятся в архив или получают новый статус.": "Check the current status and update date in the open record. Once a review is complete, a record is archived or assigned a new status."
  ,"Независимый информационный проект": "Independent information project"
  ,"A.O.G.D не является подразделением INTERPOL или государственного органа. Реестр предназначен для общественной осведомлённости и цифровой безопасности пользователей Telegram.": "A.O.G.D is not part of INTERPOL or any government authority. The registry supports public awareness and the digital safety of Telegram users."
  ,"Навигация": "Navigation"
  ,"Публичный реестр": "Public registry"
  ,"Принципы работы": "Operating principles"
  ,"Официальный канал": "Official channel"
  ,"Telegram A.O.G.D": "A.O.G.D on Telegram"
  ,"Только проверяемые сведения": "Verifiable information only"
  ,"Не предпринимайте действий самостоятельно": "Do not take independent action"
  ,"Наверх ↑": "Back to top ↑"
  ,"Статус информационной системы": "Information system status"
  ,"Система работает штатно": "Systems operational"
  ,"Защищённое соединение": "Secure connection"
  ,"Оперативная сводка": "Operational briefing"
  ,"Информационный бюллетень": "Information bulletin"
  ,"Последние обновления реестра": "Latest registry updates"
  ,"Сводка появится после первой публикации.": "The briefing will appear after the first publication."
  ,"Контур доверия": "Trust framework"
  ,"Контроль публикаций": "Publication control"
  ,"Каждая заявка проходит закрытую проверку до изменения публичного реестра.": "Every submission undergoes a private review before the public registry is changed."
  ,"Подтверждённые аккаунты": "Verified accounts"
  ,"Регистрация с проверкой электронной почты": "Registration with email verification"
  ,"Ручная модерация": "Manual moderation"
  ,"Решение принимает администрация проекта": "Decisions are made by project administrators"
  ,"Статусы обращений": "Request statuses"
  ,"Участник видит ход рассмотрения в профиле": "Members can track reviews in their profile"
  ,"Открыть центр поддержки": "Open support center"
  ,"Приёмная A.O.G.D": "A.O.G.D Reception"
  ,"Официальный диалог": "Official dialogue"
  ,"Публичные вопросы, предложения и официальные ответы администрации. Каждая публикация проходит предварительную модерацию.": "Public questions, proposals and official responses from the administration. Every post is reviewed before publication."
  ,"Задать вопрос": "Ask a question"
  ,"Премодерация до публикации": "Reviewed before publication"
  ,"Официальный ответ выделен": "Official responses are highlighted"
  ,"Приватные жалобы не публикуются": "Private complaints are never published"
  ,"Найти вопрос или ответ…": "Find a question or response…"
  ,"Все категории": "All categories"
  ,"Вопросы": "Questions"
  ,"Предложения": "Proposals"
  ,"Технические вопросы": "Technical questions"
  ,"Категория": "Category"
  ,"Обновить": "Refresh"
  ,"Загрузка официальных материалов…": "Loading official materials…"
  ,"Вопрос администрации": "Question to the administration"
  ,"Предложение": "Proposal"
  ,"Технический вопрос": "Technical question"
  ,"Жалоба": "Complaint"
  ,"Исправление данных": "Data correction"
  ,"Сообщение о безопасности": "Security report"
  ,"На модерации": "Under review"
  ,"Нужны сведения": "More information needed"
  ,"Опубликовано": "Published"
  ,"Принято": "Accepted"
  ,"Отклонено": "Rejected"
  ,"Решено": "Resolved"
  ,"Архив": "Archived"
  ,"Имя скрыто от публики": "Name hidden from the public"
  ,"Подтверждённый участник": "Verified member"
  ,"Официальный ответ": "Official response"
  ,"Ответ администрации готовится": "The administration is preparing a response"
  ,"Мне тоже интересно": "I am interested too"
  ,"Подходящих публикаций пока нет": "No matching posts yet"
  ,"Измените фильтр или задайте новый вопрос.": "Change the filter or submit a new question."
  ,"Профиль и поддержка": "Profile and support"
  ,"Требуется подтверждённый аккаунт": "A verified account is required"
  ,"Это защищает раздел от спама и позволяет вам получать ответы. Публично адрес почты никогда не показывается.": "This protects the section from spam and lets you receive responses. Your email address is never shown publicly."
  ,"Войти или зарегистрироваться": "Sign in or register"
  ,"Новое обращение": "New submission"
  ,"Публичные вопросы появляются только после проверки. Жалобы, исправления данных и сообщения о безопасности всегда остаются приватными.": "Public questions appear only after review. Complaints, data corrections and security reports always remain private."
  ,"Видимость": "Visibility"
  ,"Публично после модерации": "Public after review"
  ,"Только мне и администрации": "Only me and the administration"
  ,"Заголовок": "Title"
  ,"Кратко сформулируйте вопрос": "Summarize your question"
  ,"Содержание": "Details"
  ,"Опишите ситуацию без паролей, документов, адресов и других личных данных.": "Describe the situation without passwords, documents, addresses or other personal data."
  ,"Скрыть мой никнейм от публики": "Hide my nickname from the public"
  ,"Посетители увидят «Анонимный участник». Администрация сможет установить автора для предотвращения нарушений; такое действие фиксируется в журнале.": "Visitors will see “Anonymous member”. The administration can identify the author to prevent abuse; this action is recorded in the audit log."
  ,"Отправить на модерацию": "Submit for review"
  ,"Отправить приватно": "Submit privately"
  ,"История диалога": "Conversation history"
  ,"Мои вопросы": "My questions"
  ,"Вы ещё не обращались в приёмную.": "You have not submitted anything to the reception yet."
  ,"Удалить обращение": "Delete submission"
  ,"Ответ администрации": "Administration response"
  ,"Комментарий модератора": "Moderator note"
  ,"Публичная заявка": "Public submission"
  ,"Приватно": "Private"
  ,"Анонимно для посетителей": "Anonymous to visitors"
  ,"Публичные вопросы проходят премодерацию. Приватные обращения нельзя сделать публичными.": "Public questions are reviewed before publication. Private submissions cannot be made public."
  ,"Команда": "Team"
  ,"Сотрудники организации": "Organization staff"
  ,"Статус обновляется автоматически": "Status updates automatically"
  ,"В сети": "Online"
  ,"Не в сети": "Offline"
  ,"Статус скрыт": "Status hidden"
  ,"Показывается только добровольный статус сотрудников. Сетевые адреса и точное время активности не публикуются.": "Only voluntary staff presence is shown. Network addresses and exact activity times are not published."
  ,"Назначения в A.O.G.D": "A.O.G.D assignments"
  ,"Показывать статус «в сети»": "Show online status"
  ,"Публикуется только общий статус. IP и точное время активности остаются скрытыми.": "Only a general status is published. IP addresses and exact activity times remain private."
  ,"Состав и должности": "Staff and roles"
  ,"Состав организации": "Organization staff"
  ,"Назначайте должности, управляйте кастами и контролируйте публичные статусы сотрудников.": "Assign roles, manage groups and control public staff presence."
  ,"Должности и касты": "Roles and groups"
  ,"Системные должности защищены от удаления. Пользователь не может назначить их себе самостоятельно.": "System roles cannot be deleted. Users cannot assign roles to themselves."
  ,"Системная должность": "System role"
  ,"Пользовательская должность": "Custom role"
  ,"Название новой должности": "New role name"
  ,"Например: Аналитик": "For example: Analyst"
  ,"Цвет": "Color"
  ,"Создать должность": "Create role"
  ,"Создание…": "Creating…"
  ,"Найдите аккаунт по никнейму, почте или цифровому ID и назначьте должности.": "Find an account by nickname, email or numeric ID and assign roles."
  ,"Поиск аккаунта…": "Search accounts…"
  ,"Обычный участник": "Regular member"
  ,"Сохранить назначения": "Save assignments"
  ,"Сохранение…": "Saving…"
  ,"почта подтверждена": "email verified"
  ,"почта не подтверждена": "email not verified"
  ,"Аккаунты не найдены.": "No accounts found."
  ,"Restricted administration workspace": "Restricted administration workspace"
};

const EN_TO_RU = Object.fromEntries(Object.entries(RU_TO_EN).map(([ru, en]) => [en, ru]));

function translateDynamic(value, language) {
  if (language === "en") {
    if (value.startsWith("Также известен(-на) как: ")) return value.replace("Также известен(-на) как: ", "Also known as: ");
    if (value.startsWith("Псевдонимы: ")) return value.replace("Псевдонимы: ", "Aliases: ");
    if (value.startsWith("Фотография: ")) return value.replace("Фотография: ", "Photo: ");
    if (value.startsWith("Открыть запись: ")) return value.replace("Открыть запись: ", "Open record: ");
    if (/^\d+ записей$/.test(value)) return value.replace(" записей", " records");
    if (/^Ошибка запроса \(\d+\)$/.test(value)) return value.replace("Ошибка запроса", "Request error");
  } else {
    if (value.startsWith("Also known as: ")) return value.replace("Also known as: ", "Также известен(-на) как: ");
    if (value.startsWith("Aliases: ")) return value.replace("Aliases: ", "Псевдонимы: ");
    if (value.startsWith("Photo: ")) return value.replace("Photo: ", "Фотография: ");
    if (value.startsWith("Open record: ")) return value.replace("Open record: ", "Открыть запись: ");
    if (/^\d+ records$/.test(value)) return value.replace(" records", " записей");
    if (/^Request error \(\d+\)$/.test(value)) return value.replace("Request error", "Ошибка запроса");
  }
  return value;
}

function translateValue(value, language) {
  if (!value) return value;
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const core = value.trim();
  const dictionary = language === "en" ? RU_TO_EN : EN_TO_RU;
  return leading + (dictionary[core] || translateDynamic(core, language)) + trailing;
}

function translateNode(node, language) {
  if (node.nodeType === Node.TEXT_NODE) {
    const next = translateValue(node.nodeValue, language);
    if (next !== node.nodeValue) node.nodeValue = next;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (node.nodeType === Node.ELEMENT_NODE) {
    for (const attribute of ["placeholder", "aria-label", "title", "alt"]) {
      if (node.hasAttribute(attribute)) {
        const current = node.getAttribute(attribute);
        const next = translateValue(current, language);
        if (next !== current) node.setAttribute(attribute, next);
      }
    }
  }
  for (const child of node.childNodes) translateNode(child, language);
}

export function useInterfaceLanguage(language) {
  useEffect(() => {
    document.documentElement.lang = language;
    translateNode(document.body, language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") translateNode(mutation.target, language);
        for (const node of mutation.addedNodes) translateNode(node, language);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [language]);
}
