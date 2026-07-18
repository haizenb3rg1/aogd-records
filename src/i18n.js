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
  ,"Секрет ADMIN_TOKEN не настроен в Cloudflare.": "The ADMIN_TOKEN secret is not configured in Cloudflare."
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
